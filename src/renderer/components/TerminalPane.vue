<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type { SshDataEvent, SshSessionStatus, SshStatusEvent } from '../../shared/ssh'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string }>()

const terminalHost = ref<HTMLElement | null>(null)
const status = ref<SshSessionStatus>('connecting')
const statusMessage = ref('')

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId: string | null = null
let disposed = false
let removeDataListener: (() => void) | undefined
let removeStatusListener: (() => void) | undefined
let removeResizeListener: (() => void) | undefined
let removeInputListener: (() => void) | undefined
const pendingData = new Map<string, string[]>()
const pendingStatus = new Map<string, SshStatusEvent>()

const statusLabel = (): string => {
  if (status.value === 'connecting') return t('connecting')
  if (status.value === 'connected') return t('connected')
  if (status.value === 'closed') return t('closed')
  return t('sshUnavailable')
}

function handleData(event: SshDataEvent): void {
  if (event.sessionId !== sessionId) {
    const queued = pendingData.get(event.sessionId) || []
    queued.push(event.data)
    pendingData.set(event.sessionId, queued)
    return
  }
  terminal?.write(event.data)
}

function handleStatus(event: SshStatusEvent): void {
  if (event.sessionId !== sessionId) {
    pendingStatus.set(event.sessionId, event)
    return
  }
  status.value = event.status
  statusMessage.value = event.message || ''
}

function flushPending(id: string): void {
  const queued = pendingData.get(id) || []
  queued.forEach((data) => terminal?.write(data))
  pendingData.delete(id)
  const previousStatus = pendingStatus.get(id)
  if (previousStatus) {
    status.value = previousStatus.status
    statusMessage.value = previousStatus.message || ''
    pendingStatus.delete(id)
  }
}

function resizeTerminal(): void {
  if (!terminal || !fitAddon) return
  try {
    fitAddon.fit()
    if (sessionId) void window.api.ssh.resize(sessionId, terminal.cols, terminal.rows)
  } catch {
    // The terminal can briefly be hidden while a workspace tab changes.
  }
}

async function connect(): Promise<void> {
  if (sessionId) {
    await window.api.ssh.disconnect(sessionId).catch(() => undefined)
    sessionId = null
  }
  status.value = 'connecting'
  statusMessage.value = ''
  pendingData.clear()
  pendingStatus.clear()
  terminal?.clear()
  try {
    const result = await window.api.ssh.connect(props.connectionId)
    if (disposed) {
      await window.api.ssh.disconnect(result.sessionId).catch(() => undefined)
      return
    }
    sessionId = result.sessionId
    flushPending(result.sessionId)
    resizeTerminal()
  } catch (error) {
    status.value = 'error'
    statusMessage.value = error instanceof Error ? error.message : t('sshUnavailable')
  }
}

async function disconnect(): Promise<void> {
  if (!sessionId) return
  const current = sessionId
  sessionId = null
  await window.api.ssh.disconnect(current).catch(() => undefined)
  status.value = 'closed'
}

onMounted(() => {
  if (!terminalHost.value) return
  terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: 13,
    theme: { background: '#0a0f15', foreground: '#dbe7f4', cursor: '#68d6bd' },
    scrollback: 5000
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost.value)
  removeDataListener = window.api.ssh.onData(handleData)
  removeStatusListener = window.api.ssh.onStatus(handleStatus)
  const input = terminal.onData((data) => {
    if (sessionId) void window.api.ssh.write(sessionId, data).catch((error) => {
      status.value = 'error'
      statusMessage.value = error instanceof Error ? error.message : t('sshUnavailable')
    })
  })
  removeInputListener = () => input.dispose()
  const onWindowResize = (): void => resizeTerminal()
  window.addEventListener('resize', onWindowResize)
  removeResizeListener = () => window.removeEventListener('resize', onWindowResize)
  void connect()
  resizeTerminal()
})

onBeforeUnmount(() => {
  disposed = true
  removeDataListener?.()
  removeStatusListener?.()
  removeResizeListener?.()
  removeInputListener?.()
  if (sessionId) void window.api.ssh.disconnect(sessionId).catch(() => undefined)
  terminal?.dispose()
})
</script>

<template>
  <section class="terminal-pane">
    <div class="terminal-toolbar">
      <span class="terminal-kind">SSH</span>
      <span class="terminal-title">Terminal</span>
      <span class="terminal-status" :class="status"><span class="status-dot"></span>{{ statusLabel() }}</span>
      <span v-if="statusMessage" class="terminal-message" :title="statusMessage">{{ statusMessage }}</span>
      <button v-if="status === 'error' || status === 'closed'" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button>
      <button v-else-if="status === 'connected'" class="toolbar-button muted" @click="disconnect">{{ t('disconnect') }}</button>
    </div>
    <div ref="terminalHost" class="terminal-host"></div>
  </section>
</template>
