<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SftpEntry, SftpQueueResult, SftpTransferItem, SftpTransferStatus } from '../../shared/sftp'
import { fileIcon, joinRemotePath, parentRemotePath, transferProgress } from '../../shared/sftp'
import { t } from '../i18n'
import SplitPane from './SplitPane.vue'

type SftpPosition = 'right' | 'left' | 'top' | 'bottom'
type LocalEntry = Pick<SftpEntry, 'name' | 'path' | 'type' | 'size' | 'modifiedAt'>
type LocalDirectory = { path: string; parentPath: string; entries: LocalEntry[] }

const props = defineProps<{ connectionId: string; embedded?: boolean; position?: SftpPosition }>()
const emit = defineEmits<{ position: [position: SftpPosition] }>()

const sessionId = ref('')
const path = ref('/')
const pathInput = ref('/')
const entries = ref<SftpEntry[]>([])
const loading = ref(true)
const errorMessage = ref('')
const pendingFingerprint = ref('')
const transfers = ref<SftpTransferItem[]>([])
const transferPanelOpen = ref(true)
const localPath = ref('')
const localPathInput = ref('')
const localParentPath = ref('')
const localEntries = ref<LocalEntry[]>([])
const localLoading = ref(true)
const localError = ref('')
const entryMenu = ref<{ side: 'local' | 'remote'; entry: LocalEntry | SftpEntry; x: number; y: number } | null>(null)
const renamingEntry = ref<SftpEntry | null>(null)
const renameName = ref('')
const editor = ref<{ entry: SftpEntry; content: string; modifiedAt: number } | null>(null)
const editorSaving = ref(false)
let removeTransferListener: (() => void) | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

const activeTransfers = computed(() => transfers.value.filter((item) => item.status === 'running' || item.status === 'queued' || item.status === 'paused'))
const finishedTransfers = computed(() => transfers.value.filter((item) => item.status === 'completed' || item.status === 'error' || item.status === 'cancelled'))
const totalTransferred = computed(() => transfers.value.reduce((sum, item) => sum + item.transferred, 0))
const totalBytes = computed(() => transfers.value.reduce((sum, item) => sum + item.total, 0))

function transferEvent(event: SftpTransferItem): void {
  if (event.sessionId !== sessionId.value) return
  upsertTransfer(event)
  if (event.status === 'completed') {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { void refresh(); void refreshLocal() }, 350)
  }
}

function upsertTransfer(item: SftpTransferItem): void {
  const index = transfers.value.findIndex((current) => current.transferId === item.transferId)
  if (index >= 0) transfers.value[index] = item
  else transfers.value.push(item)
  transfers.value.sort((a, b) => a.createdAt - b.createdAt)
}

async function connect(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  pendingFingerprint.value = ''
  if (sessionId.value) await window.api.sftp.disconnect(sessionId.value).catch(() => undefined)
  sessionId.value = ''
  transfers.value = []
  try {
    const result = await window.api.sftp.connect(props.connectionId)
    if (result.trustRequired) {
      pendingFingerprint.value = result.fingerprint
      return
    }
    if (disposed) {
      await window.api.sftp.disconnect(result.sessionId).catch(() => undefined)
      return
    }
    sessionId.value = result.sessionId
    path.value = result.homePath
    pathInput.value = result.homePath
    transfers.value = await window.api.sftp.listTransfers(result.sessionId)
    await refresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('sftpUnavailable')
  } finally {
    loading.value = false
  }
}

async function trustHostKey(): Promise<void> {
  if (!pendingFingerprint.value) return
  try {
    await window.api.sftp.trustHostKey(props.connectionId, pendingFingerprint.value)
    await connect()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('sftpUnavailable')
  }
}

async function refresh(nextPath = path.value): Promise<void> {
  if (!sessionId.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    entries.value = await window.api.sftp.list(sessionId.value, nextPath)
    path.value = nextPath
    pathInput.value = nextPath
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('sftpUnavailable')
  } finally {
    loading.value = false
  }
}

function openEntry(entry: SftpEntry): void {
  if (entry.type === 'directory') void refresh(entry.path)
  else if (entry.type === 'file') void openRemoteFile(entry)
}

async function refreshLocal(nextPath?: string): Promise<void> {
  localLoading.value = true
  localError.value = ''
  try {
    const result = await window.api.app.listLocalDirectory(nextPath || localPath.value || undefined) as LocalDirectory
    localPath.value = result.path
    localPathInput.value = result.path
    localParentPath.value = result.parentPath
    localEntries.value = result.entries
  } catch (error) {
    localError.value = error instanceof Error ? error.message : t('operationFailed')
  } finally {
    localLoading.value = false
  }
}

function openLocalEntry(entry: LocalEntry): void {
  if (entry.type === 'directory') void refreshLocal(entry.path)
}

async function chooseLocalDirectory(): Promise<void> {
  const directory = await window.api.app.chooseDownloadDirectory()
  if (directory) await refreshLocal(directory)
}

function showEntryMenu(event: MouseEvent, side: 'local' | 'remote', entry: LocalEntry | SftpEntry): void {
  entryMenu.value = { side, entry, x: Math.max(4, Math.min(event.clientX, window.innerWidth - 150)), y: Math.max(4, Math.min(event.clientY, window.innerHeight - 128)) }
}

function runEntryAction(action: 'upload' | 'download' | 'open' | 'rename' | 'remove'): void {
  const menu = entryMenu.value
  entryMenu.value = null
  if (!menu) return
  if (menu.side === 'local') void queueUploads([menu.entry.path])
  else if (action === 'download') void download(menu.entry as SftpEntry)
  else if (action === 'open') void openRemoteFile(menu.entry as SftpEntry)
  else if (action === 'rename') void renameEntry(menu.entry as SftpEntry)
  else if (action === 'remove') void removeEntry(menu.entry as SftpEntry)
}

function setPosition(position: SftpPosition, event: MouseEvent): void {
  emit('position', position)
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

async function createDirectory(): Promise<void> {
  const name = window.prompt(t('folderName'))?.trim()
  if (!name || !sessionId.value) return
  try {
    await window.api.sftp.mkdir(sessionId.value, joinRemotePath(path.value, name))
    await refresh()
  } catch (error) { showError(error) }
}

function renameEntry(entry: SftpEntry): void {
  errorMessage.value = ''
  renamingEntry.value = entry
  renameName.value = entry.name
}

async function submitRename(): Promise<void> {
  const entry = renamingEntry.value
  const name = renameName.value.trim()
  if (!entry || !name || name === entry.name || !sessionId.value) return
  try {
    await window.api.sftp.rename(sessionId.value, entry.path, joinRemotePath(parentRemotePath(entry.path), name))
    renamingEntry.value = null
    await refresh()
  } catch (error) { showError(error) }
}

async function openRemoteFile(entry: SftpEntry): Promise<void> {
  if (!sessionId.value || entry.type !== 'file') return
  errorMessage.value = ''
  try {
    const result = await window.api.sftp.readText(sessionId.value, entry.path)
    editor.value = { entry, ...result }
  } catch (error) { showError(error) }
}

async function saveRemoteFile(): Promise<void> {
  if (!sessionId.value || !editor.value || editorSaving.value) return
  editorSaving.value = true
  try {
    await window.api.sftp.writeText(sessionId.value, editor.value.entry.path, editor.value.content, editor.value.modifiedAt)
    editor.value = null
    await refresh()
  } catch (error) { showError(error) } finally { editorSaving.value = false }
}

async function removeEntry(entry: SftpEntry): Promise<void> {
  if (!sessionId.value || !window.confirm(t('deleteRemoteConfirm', { name: entry.name }))) return
  try {
    await window.api.sftp.remove(sessionId.value, entry.path, entry.type)
    await refresh()
  } catch (error) { showError(error) }
}

async function chooseUploadFiles(): Promise<void> {
  const paths = await window.api.app.chooseUploadFiles()
  if (paths.length) await queueUploads(paths)
}

async function chooseUploadFolder(): Promise<void> {
  const folder = await window.api.app.chooseUploadFolder()
  if (folder) await queueUploads([folder])
}

async function queueUploads(paths: string[]): Promise<void> {
  if (!sessionId.value) return
  try {
    let result: SftpQueueResult = await window.api.sftp.enqueueUploads(sessionId.value, paths, path.value, false)
    if (result.conflicts.length) {
      if (!confirmOverwrite(result)) return
      result = await window.api.sftp.enqueueUploads(sessionId.value, paths, path.value, true)
    }
    transferPanelOpen.value = true
    if (!result.transferIds.length) await refresh()
  } catch (error) { showError(error) }
}

function startEntryDrag(event: DragEvent, side: 'local' | 'remote', entry: LocalEntry | SftpEntry): void {
  event.dataTransfer?.setData('application/x-remotehub-sftp-entry', JSON.stringify({ side, path: entry.path }))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function draggedEntry(event: DragEvent): { side: 'local' | 'remote'; path: string } | null {
  try {
    const value = JSON.parse(event.dataTransfer?.getData('application/x-remotehub-sftp-entry') || '') as { side?: string; path?: string }
    return (value.side === 'local' || value.side === 'remote') && typeof value.path === 'string' ? value as { side: 'local' | 'remote'; path: string } : null
  } catch { return null }
}

function dropOnRemote(event: DragEvent): void {
  event.preventDefault()
  const internal = draggedEntry(event)
  if (internal?.side === 'local') return void queueUploads([internal.path])
  const paths = [...(event.dataTransfer?.files || [])].map((file) => window.api.files.getPath(file)).filter(Boolean)
  if (paths.length) void queueUploads(paths)
}

function dropOnLocal(event: DragEvent): void {
  event.preventDefault()
  const internal = draggedEntry(event)
  const entry = internal?.side === 'remote' ? entries.value.find((item) => item.path === internal.path) : undefined
  if (entry) void download(entry)
}

async function download(entry: SftpEntry): Promise<void> {
  if (!sessionId.value) return
  const localDirectory = localPath.value || await window.api.app.chooseDownloadDirectory()
  if (!localDirectory) return
  try {
    let result: SftpQueueResult = await window.api.sftp.enqueueDownload(sessionId.value, entry.path, localDirectory, entry.type, false)
    if (result.conflicts.length) {
      if (!confirmOverwrite(result)) return
      result = await window.api.sftp.enqueueDownload(sessionId.value, entry.path, localDirectory, entry.type, true)
    }
    transferPanelOpen.value = true
  } catch (error) { showError(error) }
}

function confirmOverwrite(result: SftpQueueResult): boolean {
  const examples = result.conflicts.slice(0, 3).map((item) => `• ${item.name}`).join('\n')
  const remaining = result.conflicts.length > 3 ? `\n${t('andMore', { count: result.conflicts.length - 3 })}` : ''
  return window.confirm(`${t('overwriteConfirm', { count: result.conflicts.length })}\n\n${examples}${remaining}`)
}

async function pauseOrResume(item: SftpTransferItem): Promise<void> {
  if (!sessionId.value) return
  try {
    const updated = item.status === 'paused'
      ? await window.api.sftp.resumeTransfer(sessionId.value, item.transferId)
      : await window.api.sftp.pauseTransfer(sessionId.value, item.transferId)
    upsertTransfer(updated)
  } catch (error) { showError(error) }
}

async function cancelTransfer(item: SftpTransferItem): Promise<void> {
  if (!sessionId.value) return
  try { upsertTransfer(await window.api.sftp.cancelTransfer(sessionId.value, item.transferId)) } catch (error) { showError(error) }
}

async function retryTransfer(item: SftpTransferItem): Promise<void> {
  if (!sessionId.value) return
  try { upsertTransfer(await window.api.sftp.retryTransfer(sessionId.value, item.transferId)) } catch (error) { showError(error) }
}

async function clearFinished(): Promise<void> {
  if (!sessionId.value) return
  try {
    await window.api.sftp.clearFinishedTransfers(sessionId.value)
    transfers.value = transfers.value.filter((item) => item.status === 'queued' || item.status === 'running' || item.status === 'paused')
  } catch (error) { showError(error) }
}

function showError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : t('operationFailed')
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function statusText(status: SftpTransferStatus): string {
  const keys: Record<SftpTransferStatus, Parameters<typeof t>[0]> = { queued: 'queued', running: 'transferring', paused: 'paused', completed: 'completed', error: 'failed', cancelled: 'cancelled' }
  return t(keys[status])
}

function canPause(item: SftpTransferItem): boolean {
  return item.status === 'queued' || item.status === 'running' || item.status === 'paused'
}

function canCancel(item: SftpTransferItem): boolean {
  return item.status === 'queued' || item.status === 'running' || item.status === 'paused'
}

onMounted(() => {
  removeTransferListener = window.api.sftp.onTransfer(transferEvent)
  document.addEventListener('pointerdown', closeEntryMenu)
  void refreshLocal()
  void connect()
})

onBeforeUnmount(() => {
  disposed = true
  if (refreshTimer) clearTimeout(refreshTimer)
  removeTransferListener?.()
  document.removeEventListener('pointerdown', closeEntryMenu)
  if (sessionId.value) void window.api.sftp.disconnect(sessionId.value).catch(() => undefined)
})

function closeEntryMenu(): void {
  entryMenu.value = null
}
</script>

<template>
  <section class="sftp-pane">
    <div class="sftp-toolbar">
      <span class="terminal-kind">SFTP</span>
      <button class="toolbar-button" :disabled="!sessionId" @click="chooseUploadFiles">⇧ {{ t('upload') }}</button>
      <button class="toolbar-button" :disabled="!sessionId" @click="chooseUploadFolder">▰ {{ t('uploadFolder') }}</button>
      <button class="toolbar-button" :disabled="!sessionId" @click="createDirectory">＋ {{ t('newFolder') }}</button>
      <details v-if="embedded" class="sftp-layout-menu">
        <summary :title="t('sftpLayout')" :aria-label="t('sftpLayout')">•••</summary>
        <div><button :class="{ active: position === 'left' }" @click="setPosition('left', $event)">← {{ t('dockLeft') }}</button><button :class="{ active: position === 'right' }" @click="setPosition('right', $event)">→ {{ t('dockRight') }}</button><button :class="{ active: position === 'top' }" @click="setPosition('top', $event)">↑ {{ t('dockTop') }}</button><button :class="{ active: position === 'bottom' }" @click="setPosition('bottom', $event)">↓ {{ t('dockBottom') }}</button></div>
      </details>
    </div>
    <div v-if="pendingFingerprint" class="terminal-host-key"><span>{{ t('hostKeyPrompt') }}</span><code>{{ t('hostKeyFingerprint') }}: {{ pendingFingerprint }}</code><button class="toolbar-button" @click="trustHostKey">{{ t('trustHostKey') }}</button></div>
    <div v-if="errorMessage" class="sftp-error"><span>{{ errorMessage }}</span><button class="icon-button" @click="errorMessage = ''">×</button><button v-if="!sessionId" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button></div>
    <SplitPane class="sftp-file-split" :direction="position === 'left' || position === 'right' ? 'vertical' : 'horizontal'">
      <template #first><section class="sftp-browser local-browser" @dragover.prevent @drop.stop="dropOnLocal">
        <div class="sftp-browser-title"><strong>▣ {{ t('localFiles') }}</strong><button class="text-button" @click="chooseLocalDirectory">{{ t('chooseFolder') }}</button></div>
        <div class="sftp-browser-nav"><button :disabled="!localPath || localParentPath === localPath" @click="refreshLocal(localParentPath)">↑</button><form class="sftp-path" @submit.prevent="refreshLocal(localPathInput)"><input v-model="localPathInput"><button type="submit">{{ t('go') }}</button></form><button @click="refreshLocal()">↻</button></div>
        <div v-if="localError" class="sftp-error"><span>{{ localError }}</span><button class="icon-button" @click="localError = ''">×</button></div>
        <div class="sftp-table-wrap">
          <table class="sftp-table">
            <thead><tr><th>{{ t('name') }}</th><th>{{ t('size') }}</th><th>{{ t('modified') }}</th><th>{{ t('actions') }}</th></tr></thead>
            <tbody>
              <tr v-if="localPath && localParentPath !== localPath" class="parent-entry" @click="refreshLocal(localParentPath)"><td><span class="file-icon">{{ fileIcon('directory') }}</span><button class="file-name">..</button></td><td>—</td><td>—</td><td></td></tr>
              <tr v-if="localLoading"><td colspan="4" class="sftp-empty">{{ t('loading') }}</td></tr>
              <tr v-else-if="!localEntries.length"><td colspan="4" class="sftp-empty">{{ t('emptyFolder') }}</td></tr>
              <tr v-for="entry in localEntries" :key="entry.path" draggable="true" @dragstart="startEntryDrag($event, 'local', entry)" @dblclick="openLocalEntry(entry)" @contextmenu.prevent="showEntryMenu($event, 'local', entry)">
                <td><span class="file-icon">{{ fileIcon(entry.type, entry.name) }}</span><button class="file-name" @click="openLocalEntry(entry)">{{ entry.name }}</button></td><td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td><td>{{ entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '—' }}</td><td class="file-actions"><button @click="queueUploads([entry.path])">{{ t('upload') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section></template>
      <template #second><section class="sftp-browser remote-browser" @dragover.prevent @drop.stop="dropOnRemote">
        <div class="sftp-browser-title"><strong>☁ {{ t('remoteFiles') }}</strong><span>{{ entries.length }}</span></div>
        <div class="sftp-browser-nav"><button :disabled="!sessionId || path === '/'" @click="refresh(parentRemotePath(path))">↑</button><form class="sftp-path" @submit.prevent="refresh(pathInput)"><input v-model="pathInput" :disabled="!sessionId"><button type="submit" :disabled="!sessionId">{{ t('go') }}</button></form><button :disabled="!sessionId" @click="refresh()">↻</button></div>
        <div class="sftp-table-wrap">
          <table class="sftp-table">
            <thead><tr><th>{{ t('name') }}</th><th>{{ t('size') }}</th><th>{{ t('modified') }}</th><th>{{ t('actions') }}</th></tr></thead>
            <tbody>
              <tr v-if="path !== '/'" class="parent-entry" @click="refresh(parentRemotePath(path))"><td><span class="file-icon">{{ fileIcon('directory') }}</span><button class="file-name">..</button></td><td>—</td><td>—</td><td></td></tr>
              <tr v-if="loading"><td colspan="4" class="sftp-empty">{{ t('loading') }}</td></tr>
              <tr v-else-if="!entries.length"><td colspan="4" class="sftp-empty">{{ t('emptyFolder') }}</td></tr>
              <tr v-for="entry in entries" :key="entry.path" draggable="true" @dragstart="startEntryDrag($event, 'remote', entry)" @dblclick="openEntry(entry)" @contextmenu.prevent="showEntryMenu($event, 'remote', entry)">
                <td><span class="file-icon">{{ fileIcon(entry.type, entry.name) }}</span><button class="file-name" @click="openEntry(entry)">{{ entry.name }}</button></td><td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td><td>{{ entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '—' }}</td><td class="file-actions"><button @click="download(entry)">{{ t('download') }}</button><button @click="renameEntry(entry)">{{ t('rename') }}</button><button class="danger" @click="removeEntry(entry)">{{ t('remove') }}</button></td>
              </tr>
            </tbody>
          </table>
          <div class="sftp-drop-hint">{{ t('dropUploadHint') }}</div>
        </div>
      </section></template>
    </SplitPane>
    <section v-if="transfers.length" class="transfer-manager" :class="{ collapsed: !transferPanelOpen }">
      <button class="transfer-header" @click="transferPanelOpen = !transferPanelOpen">
        <span>⇅ {{ t('transferQueue') }}</span>
        <span>{{ t('transferSummary', { active: activeTransfers.length, total: transfers.length }) }} · {{ formatSize(totalTransferred) }} / {{ formatSize(totalBytes) }}</span>
        <span>{{ transferPanelOpen ? '⌄' : '⌃' }}</span>
      </button>
      <template v-if="transferPanelOpen">
        <div class="transfer-list">
          <div v-for="item in transfers" :key="item.transferId" class="transfer-row">
            <span class="transfer-direction">{{ item.direction === 'upload' ? '⇧' : '⇩' }}</span>
            <span class="transfer-copy"><strong :title="item.relativePath">{{ item.relativePath }}</strong><span class="transfer-progress"><i :style="{ width: `${transferProgress(item)}%` }"></i></span><small>{{ statusText(item.status) }} · {{ transferProgress(item) }}% · {{ formatSize(item.transferred) }} / {{ formatSize(item.total) }}<template v-if="item.speed"> · {{ formatSize(item.speed) }}/s</template><template v-if="item.message"> · {{ item.message }}</template></small></span>
            <span class="transfer-actions"><button v-if="canPause(item)" @click="pauseOrResume(item)">{{ item.status === 'paused' ? t('resume') : t('pause') }}</button><button v-if="canCancel(item)" class="danger" @click="cancelTransfer(item)">{{ t('cancel') }}</button><button v-if="item.status === 'error' || item.status === 'cancelled'" @click="retryTransfer(item)">{{ t('retry') }}</button></span>
          </div>
        </div>
        <div class="transfer-footer"><span>{{ activeTransfers.length ? t('parallelTransfers') : t('transferIdle') }}</span><button v-if="finishedTransfers.length" class="text-button" @click="clearFinished">{{ t('clearFinished') }}</button></div>
      </template>
    </section>
    <div v-if="entryMenu" class="sftp-context-menu" :style="{ left: `${entryMenu.x}px`, top: `${entryMenu.y}px` }" @pointerdown.stop>
      <button v-if="entryMenu.side === 'local'" @click="runEntryAction('upload')">⇧ {{ t('upload') }}</button>
      <template v-else><button v-if="entryMenu.entry.type === 'file'" @click="runEntryAction('open')">{{ t('openFile') }}</button><button @click="runEntryAction('download')">⇩ {{ t('download') }}</button><button @click="runEntryAction('rename')">{{ t('rename') }}</button><button class="danger" @click="runEntryAction('remove')">{{ t('remove') }}</button></template>
    </div>
    <div v-if="renamingEntry" class="modal-layer" @click.self="renamingEntry = null">
      <form class="connection-dialog" @submit.prevent="submitRename">
        <div class="dialog-heading"><h2>{{ t('rename') }}</h2><button type="button" class="icon-button" :aria-label="t('cancel')" @click="renamingEntry = null">×</button></div>
        <div v-if="errorMessage" class="sftp-error"><span>{{ errorMessage }}</span></div>
        <label class="field"><span>{{ t('newName') }}</span><input v-model="renameName" required autofocus></label>
        <div class="dialog-actions"><button type="button" class="button secondary" @click="renamingEntry = null">{{ t('cancel') }}</button><button type="submit" class="button primary">{{ t('rename') }}</button></div>
      </form>
    </div>
    <div v-if="editor" class="modal-layer" @click.self="editor = null">
      <div class="connection-dialog sftp-editor">
        <div class="dialog-heading"><div><span class="eyebrow">SFTP</span><h2>{{ editor.entry.name }}</h2></div><button type="button" class="icon-button" :aria-label="t('cancel')" @click="editor = null">×</button></div>
        <div v-if="errorMessage" class="sftp-error"><span>{{ errorMessage }}</span></div>
        <textarea v-model="editor.content" :aria-label="t('onlineEditor')" spellcheck="false"></textarea>
        <div class="dialog-actions"><button type="button" class="button secondary" @click="editor = null">{{ t('cancel') }}</button><button type="button" class="button primary" :disabled="editorSaving" @click="saveRemoteFile">{{ editorSaving ? t('saving') : t('saveFile') }}</button></div>
      </div>
    </div>
  </section>
</template>
