export type LocalShellSessionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface LocalShellDataEvent {
  sessionId: string
  data: string
}

export interface LocalShellStatusEvent {
  sessionId: string
  status: LocalShellSessionStatus
  message?: string
}

export function localShellName(platform: string): string {
  return platform === 'darwin' ? 'Zsh' : platform === 'win32' ? 'PowerShell' : platform === 'linux' ? 'Bash' : 'Shell'
}

export function localShellCommand(platform: string, environment: Record<string, string | undefined>): { command: string; args: string[] } {
  return platform === 'win32'
    ? { command: 'powershell.exe', args: ['-NoLogo'] }
    : { command: environment.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'), args: ['-i'] }
}
