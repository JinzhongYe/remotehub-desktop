<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type { SerialDataEvent, SerialSessionStatus, SerialStatusEvent } from '../../shared/serial'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string; active: boolean }>()
const terminalHost = ref<HTMLElement | null>(null)
const status = ref<SerialSessionStatus>('connecting')
const statusMessage = ref('')
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId = ''
let disposed = false
let removeDataListener: (() => void) | undefined
let removeStatusListener: (() => void) | undefined
let removeResizeListener: (() => void) | undefined
let removeInputListener: (() => void) | undefined
const pendingData = new Map<string, string[]>()
const pendingStatus = new Map<string, SerialStatusEvent>()

function statusLabel(): string {
  return status.value === 'connecting' ? t('connecting') : status.value === 'connected' ? t('connected') : status.value === 'closed' ? t('closed') : t('serialUnavailable')
}

function handleData(event: SerialDataEvent): void {
  if (event.sessionId === sessionId) terminal?.write(event.data)
  else if (!sessionId && status.value === 'connecting') pendingData.set(event.sessionId, [...(pendingData.get(event.sessionId) || []), event.data])
}

function handleStatus(event: SerialStatusEvent): void {
  if (event.sessionId === sessionId) {
    status.value = event.status
    statusMessage.value = event.message || ''
  } else if (!sessionId && status.value === 'connecting') pendingStatus.set(event.sessionId, event)
}

function fit(): void {
  try { fitAddon?.fit() } catch { /* hidden tab */ }
}

async function connect(): Promise<void> {
  if (sessionId) await window.api.serial.disconnect(sessionId).catch(() => undefined)
  sessionId = ''
  status.value = 'connecting'
  statusMessage.value = ''
  pendingData.clear()
  pendingStatus.clear()
  terminal?.clear()
  try {
    const result = await window.api.serial.connect(props.connectionId)
    if (disposed) {
      await window.api.serial.disconnect(result.sessionId).catch(() => undefined)
      return
    }
    sessionId = result.sessionId
    for (const data of pendingData.get(sessionId) || []) terminal?.write(data)
    const previousStatus = pendingStatus.get(sessionId)
    if (previousStatus) {
      status.value = previousStatus.status
      statusMessage.value = previousStatus.message || ''
    }
    pendingData.clear()
    pendingStatus.clear()
    fit()
  } catch (error) {
    status.value = 'error'
    statusMessage.value = error instanceof Error ? error.message : t('serialUnavailable')
  }
}

async function disconnect(): Promise<void> {
  if (!sessionId) return
  const current = sessionId
  sessionId = ''
  await window.api.serial.disconnect(current).catch(() => undefined)
  status.value = 'closed'
}

onMounted(() => {
  if (!terminalHost.value) return
  terminal = new Terminal({ convertEol: true, cursorBlink: true, fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 13, theme: { background: '#0a0f15', foreground: '#dbe7f4', cursor: '#68d6bd' }, scrollback: 10000 })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost.value)
  removeDataListener = window.api.serial.onData(handleData)
  removeStatusListener = window.api.serial.onStatus(handleStatus)
  const input = terminal.onData((data) => {
    if (sessionId) void window.api.serial.write(sessionId, data).catch((error) => {
      status.value = 'error'
      statusMessage.value = error instanceof Error ? error.message : t('serialUnavailable')
    })
  })
  removeInputListener = () => input.dispose()
  const onResize = (): void => fit()
  window.addEventListener('resize', onResize)
  removeResizeListener = () => window.removeEventListener('resize', onResize)
  void connect()
  fit()
})

watch(() => props.active, (active) => { if (active) void nextTick(fit) })

onBeforeUnmount(() => {
  disposed = true
  removeDataListener?.()
  removeStatusListener?.()
  removeResizeListener?.()
  removeInputListener?.()
  if (sessionId) void window.api.serial.disconnect(sessionId).catch(() => undefined)
  terminal?.dispose()
})
</script>

<template>
  <section class="terminal-pane">
    <div class="terminal-toolbar">
      <span class="terminal-kind serial-kind">COM</span><span class="terminal-title">{{ t('serialTerminal') }}</span>
      <span class="terminal-status" :class="status"><span class="status-dot"></span>{{ statusLabel() }}</span>
      <span v-if="statusMessage" class="terminal-message" :title="statusMessage">{{ statusMessage }}</span>
      <button v-if="status === 'error' || status === 'closed'" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button>
      <button v-else-if="status === 'connected'" class="toolbar-button muted" @click="disconnect">{{ t('disconnect') }}</button>
    </div>
    <div ref="terminalHost" class="terminal-host"></div>
  </section>
</template>
