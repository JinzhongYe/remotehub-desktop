export type SshSessionStatus = 'connecting' | 'connected' | 'error' | 'closed'

export interface SshPasswordOptions {
  password: string
  savePassword: boolean
}

export type SshConnectResult = { sessionId: string; trustRequired?: false } | { trustRequired: true; fingerprint: string }

export interface SshDataEvent {
  sessionId: string
  data: string
  sequence?: number
}

export interface SshStatusEvent {
  sessionId: string
  status: SshSessionStatus
  message?: string
  code?: string
}

export interface SshExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export const SERVER_STATUS_COMMAND = String.raw`
export LC_ALL=C
printf 'user\t%s\n' "$(id -un 2>/dev/null)"
printf 'host\t%s\n' "$(hostname -f 2>/dev/null || hostname 2>/dev/null)"
if [ -r /etc/os-release ]; then . /etc/os-release; printf 'os\t%s\n' "$PRETTY_NAME"; else printf 'os\t%s\n' "$(uname -s 2>/dev/null)"; fi
printf 'kernel\t%s\n' "$(uname -sr 2>/dev/null)"
awk 'NR==1 {printf "uptime_seconds\t%.0f\n", $1}' /proc/uptime 2>/dev/null
printf 'cpu_cores\t%s\n' "$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 0)"
printf 'load_average\t%s\n' "$(cut -d ' ' -f 1-3 /proc/loadavg 2>/dev/null)"
if [ -r /proc/stat ]; then
  read _ u1 n1 s1 i1 w1 q1 z1 t1 _ < /proc/stat
  total1=$((u1+n1+s1+i1+w1+q1+z1+t1)); idle1=$((i1+w1)); sleep 0.2
  read _ u2 n2 s2 i2 w2 q2 z2 t2 _ < /proc/stat
  total2=$((u2+n2+s2+i2+w2+q2+z2+t2)); idle2=$((i2+w2))
  awk -v ticks="$((total2-total1))" -v idle_ticks="$((idle2-idle1))" 'BEGIN {value=0; if (ticks>0) value=(ticks-idle_ticks)*100/ticks; printf "cpu_percent\t%.1f\n", value}'
fi
awk '/^MemTotal:/ {mt=$2} /^MemAvailable:/ {ma=$2} /^SwapTotal:/ {st=$2} /^SwapFree:/ {sf=$2} END {printf "memory_total_kb\t%.0f\nmemory_used_kb\t%.0f\nswap_total_kb\t%.0f\nswap_used_kb\t%.0f\n", mt, mt-ma, st, st-sf}' /proc/meminfo 2>/dev/null
df -Pk / 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); printf "disk_total_kb\t%s\ndisk_used_kb\t%s\ndisk_percent\t%s\n", $2, $3, $5}'
awk -F: 'NR>2 {gsub(/ /, "", $1); if ($1 != "lo") {gsub(/^ +/, "", $2); split($2, v, / +/); rx+=v[1]; tx+=v[9]}} END {printf "network_rx_bytes\t%.0f\nnetwork_tx_bytes\t%.0f\n", rx, tx}' /proc/net/dev 2>/dev/null
printf 'process_count\t%s\n' "$(ps -e --no-headers 2>/dev/null | wc -l)"
ps -eo pid=,pcpu=,rss=,comm= --sort=-pcpu 2>/dev/null | head -n 6 | awk '{printf "process\t%s|%s|%s|%s\n", $1, $2, $3, $4}'
`.trim()

export interface ServerProcess {
  pid: number
  cpuPercent: number
  memoryKb: number
  command: string
}

export interface ServerStatus {
  user: string
  host: string
  os: string
  kernel: string
  uptimeSeconds: number
  cpuPercent: number
  cpuCores: number
  loadAverage: string
  memoryUsedKb: number
  memoryTotalKb: number
  swapUsedKb: number
  swapTotalKb: number
  diskUsedKb: number
  diskTotalKb: number
  diskPercent: number
  networkRxBytes: number
  networkTxBytes: number
  processCount: number
  processes: ServerProcess[]
}

export function parseServerStatus(output: string): ServerStatus {
  const values = new Map<string, string>()
  const processes: ServerProcess[] = []
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('\t')
    if (separator < 1) continue
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1).trim()
    if (key === 'process') {
      const [pid, cpuPercent, memoryKb, command] = value.split('|')
      if (command) processes.push({ pid: number(pid), cpuPercent: number(cpuPercent), memoryKb: number(memoryKb), command })
    } else values.set(key, value)
  }
  const get = (key: string): string => values.get(key) || ''
  return {
    user: get('user'), host: get('host'), os: get('os'), kernel: get('kernel'),
    uptimeSeconds: number(get('uptime_seconds')), cpuPercent: Math.min(100, number(get('cpu_percent'))),
    cpuCores: number(get('cpu_cores')), loadAverage: get('load_average'),
    memoryUsedKb: number(get('memory_used_kb')), memoryTotalKb: number(get('memory_total_kb')),
    swapUsedKb: number(get('swap_used_kb')), swapTotalKb: number(get('swap_total_kb')),
    diskUsedKb: number(get('disk_used_kb')), diskTotalKb: number(get('disk_total_kb')),
    diskPercent: Math.min(100, number(get('disk_percent'))), networkRxBytes: number(get('network_rx_bytes')),
    networkTxBytes: number(get('network_tx_bytes')), processCount: number(get('process_count')), processes
  }
}

function number(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function sshErrorCode(code?: string, level?: string): string {
  if (level === 'client-authentication') return 'SSH_AUTHENTICATION_FAILED'
  if (level === 'client-timeout' || code === 'ETIMEDOUT') return 'SSH_TIMEOUT'
  if (code === 'ECONNREFUSED') return 'SSH_CONNECTION_REFUSED'
  if (code === 'ENOTFOUND') return 'SSH_HOST_NOT_FOUND'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'SSH_NETWORK_UNREACHABLE'
  if (code === 'ECONNRESET') return 'SSH_CONNECTION_RESET'
  if (level === 'handshake' || level === 'protocol') return 'SSH_HANDSHAKE_FAILED'
  return 'SSH_CONNECTION_FAILED'
}
