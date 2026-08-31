<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal, type ITheme } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import type { SshDataEvent, SshSessionStatus, SshStatusEvent } from '../../shared/ssh'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string; active: boolean }>()

const terminalHost = ref<HTMLElement | null>(null)
const status = ref<SshSessionStatus>('connecting')
const statusMessage = ref('')
const pendingFingerprint = ref('')
const contextMenu = ref<{ x: number; y: number } | null>(null)
const hasSelection = ref(false)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId: string | null = null
let disposed = false
let removeDataListener: (() => void) | undefined
let removeStatusListener: (() => void) | undefined
let removeResizeListener: (() => void) | undefined
let removeInputListener: (() => void) | undefined
let removeSelectionListener: (() => void) | undefined
let removeContextMenuListener: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
const pendingData = new Map<string, string[]>()
const pendingStatus = new Map<string, SshStatusEvent>()

const terminalThemes: Record<'dark' | 'light', ITheme> = {
  dark: { background: '#0f1720', foreground: '#d8e1ea', cursor: '#68d6bd', selectionBackground: '#315d86', selectionForeground: '#ffffff', selectionInactiveBackground: '#24425f' },
  light: { background: '#f8fafc', foreground: '#263445', cursor: '#1769aa', selectionBackground: '#b9d7f0', selectionForeground: '#101820', selectionInactiveBackground: '#d7e6f2' }
}

function terminalTheme(): ITheme {
  return terminalThemes[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark']
}

const statusLabel = (): string => {
  if (status.value === 'connecting') return t('connecting')
  if (status.value === 'connected') return t('connected')
  if (status.value === 'closed') return t('closed')
  return t('sshUnavailable')
}

function handleData(event: SshDataEvent): void {
  if (event.sessionId !== sessionId) {
    if (!sessionId && status.value === 'connecting') {
      const queued = pendingData.get(event.sessionId) || []
      queued.push(event.data)
      pendingData.set(event.sessionId, queued)
    }
    return
  }
  terminal?.write(event.data)
}

function handleStatus(event: SshStatusEvent): void {
  if (event.sessionId !== sessionId) {
    if (!sessionId && status.value === 'connecting') pendingStatus.set(event.sessionId, event)
    return
  }
  status.value = event.status
  statusMessage.value = event.message || ''
}

function flushPending(id: string): void {
  const queued = pendingData.get(id) || []
  queued.forEach((data) => terminal?.write(data))
  const previousStatus = pendingStatus.get(id)
  if (previousStatus) {
    status.value = previousStatus.status
    statusMessage.value = previousStatus.message || ''
  }
  pendingData.clear()
  pendingStatus.clear()
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
  pendingFingerprint.value = ''
  pendingData.clear()
  pendingStatus.clear()
  terminal?.clear()
  try {
    const result = await window.api.ssh.connect(props.connectionId)
    if (result.trustRequired) {
      if (disposed) return
      pendingData.clear()
      pendingStatus.clear()
      pendingFingerprint.value = result.fingerprint
      status.value = 'error'
      statusMessage.value = ''
      return
    }
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

async function trustHostKey(): Promise<void> {
  const fingerprint = pendingFingerprint.value
  if (!fingerprint) return
  try {
    await window.api.ssh.trustHostKey(props.connectionId, fingerprint)
    await connect()
  } catch (error) {
    status.value = 'error'
    statusMessage.value = error instanceof Error ? error.message : t('sshUnavailable')
  }
}

function showContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  hasSelection.value = terminal?.hasSelection() ?? false
  contextMenu.value = {
    x: Math.max(4, Math.min(event.clientX, window.innerWidth - 104)),
    y: Math.max(4, Math.min(event.clientY, window.innerHeight - 106))
  }
}

async function copySelection(): Promise<void> {
  const selection = terminal?.getSelection()
  contextMenu.value = null
  if (!selection) return
  try {
    await window.api.app.copyText(selection)
    terminal?.focus()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : t('sshUnavailable')
  }
}

async function pasteClipboard(): Promise<void> {
  contextMenu.value = null
  if (!sessionId) return
  try {
    const text = await window.api.app.readText()
    if (text) await window.api.ssh.write(sessionId, text)
    terminal?.focus()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : t('sshUnavailable')
  }
}

function selectAll(): void {
  terminal?.selectAll()
  hasSelection.value = terminal?.hasSelection() ?? false
  contextMenu.value = null
  terminal?.focus()
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
    theme: terminalTheme(),
    scrollback: 5000
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost.value)
  themeObserver = new MutationObserver(() => { if (terminal) terminal.options.theme = terminalTheme() })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  resizeObserver = new ResizeObserver(() => { if (props.active) resizeTerminal() })
  resizeObserver.observe(terminalHost.value)
  removeDataListener = window.api.ssh.onData(handleData)
  removeStatusListener = window.api.ssh.onStatus(handleStatus)
  const input = terminal.onData((data) => {
    if (sessionId) void window.api.ssh.write(sessionId, data).catch((error) => {
      status.value = 'error'
      statusMessage.value = error instanceof Error ? error.message : t('sshUnavailable')
    })
  })
  removeInputListener = () => input.dispose()
  const selection = terminal.onSelectionChange(() => {
    hasSelection.value = terminal?.hasSelection() ?? false
  })
  removeSelectionListener = () => selection.dispose()
  const onWindowResize = (): void => resizeTerminal()
  window.addEventListener('resize', onWindowResize)
  removeResizeListener = () => window.removeEventListener('resize', onWindowResize)
  const closeContextMenu = (): void => { contextMenu.value = null }
  document.addEventListener('pointerdown', closeContextMenu)
  removeContextMenuListener = () => document.removeEventListener('pointerdown', closeContextMenu)
  void connect()
  resizeTerminal()
})

watch(() => props.active, (active) => {
  if (active) void nextTick(resizeTerminal)
})

onBeforeUnmount(() => {
  disposed = true
  removeDataListener?.()
  removeStatusListener?.()
  removeResizeListener?.()
  removeInputListener?.()
  removeSelectionListener?.()
  removeContextMenuListener?.()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
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
      <button v-if="!pendingFingerprint && (status === 'error' || status === 'closed')" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button>
      <button v-else-if="status === 'connected'" class="toolbar-button muted" @click="disconnect">{{ t('disconnect') }}</button>
    </div>
    <div v-if="pendingFingerprint" class="terminal-host-key">
      <span>{{ t('hostKeyPrompt') }}</span><code>{{ t('hostKeyFingerprint') }}: {{ pendingFingerprint }}</code><button class="toolbar-button" @click="trustHostKey">{{ t('trustHostKey') }}</button>
    </div>
    <div ref="terminalHost" class="terminal-host" @contextmenu.capture.prevent.stop="showContextMenu"></div>
    <div v-if="contextMenu" class="terminal-context-menu" role="menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @pointerdown.stop>
      <button role="menuitem" :disabled="!hasSelection" @click="copySelection">{{ t('copy') }}</button>
      <button role="menuitem" :disabled="status !== 'connected'" @click="pasteClipboard">{{ t('paste') }}</button>
      <button role="menuitem" @click="selectAll">{{ t('selectAll') }}</button>
    </div>
  </section>
</template>
