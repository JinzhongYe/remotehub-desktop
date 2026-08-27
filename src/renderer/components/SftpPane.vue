<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SftpEntry, SftpQueueResult, SftpTransferItem, SftpTransferStatus } from '../../shared/sftp'
import { joinRemotePath, parentRemotePath, transferProgress } from '../../shared/sftp'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string }>()

const sessionId = ref('')
const path = ref('/')
const pathInput = ref('/')
const entries = ref<SftpEntry[]>([])
const loading = ref(true)
const errorMessage = ref('')
const pendingFingerprint = ref('')
const transfers = ref<SftpTransferItem[]>([])
const transferPanelOpen = ref(true)
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
  if (event.status === 'completed' && event.direction === 'upload') {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 350)
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
}

async function createDirectory(): Promise<void> {
  const name = window.prompt(t('folderName'))?.trim()
  if (!name || !sessionId.value) return
  try {
    await window.api.sftp.mkdir(sessionId.value, joinRemotePath(path.value, name))
    await refresh()
  } catch (error) { showError(error) }
}

async function renameEntry(entry: SftpEntry): Promise<void> {
  const name = window.prompt(t('newName'), entry.name)?.trim()
  if (!name || name === entry.name || !sessionId.value) return
  try {
    await window.api.sftp.rename(sessionId.value, entry.path, joinRemotePath(path.value, name))
    await refresh()
  } catch (error) { showError(error) }
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

function dropFiles(event: DragEvent): void {
  event.preventDefault()
  const paths = [...(event.dataTransfer?.files || [])].map((file) => window.api.files.getPath(file)).filter(Boolean)
  if (paths.length) void queueUploads(paths)
}

async function download(entry: SftpEntry): Promise<void> {
  if (!sessionId.value) return
  const localDirectory = await window.api.app.chooseDownloadDirectory()
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
  void connect()
})

onBeforeUnmount(() => {
  disposed = true
  if (refreshTimer) clearTimeout(refreshTimer)
  removeTransferListener?.()
  if (sessionId.value) void window.api.sftp.disconnect(sessionId.value).catch(() => undefined)
})
</script>

<template>
  <section class="sftp-pane" @dragover.prevent @drop="dropFiles">
    <div class="sftp-toolbar">
      <span class="terminal-kind">SFTP</span>
      <button class="toolbar-button muted" :disabled="!sessionId || path === '/'" @click="refresh(parentRemotePath(path))">↑ {{ t('parentFolder') }}</button>
      <form class="sftp-path" @submit.prevent="refresh(pathInput)"><input v-model="pathInput" :disabled="!sessionId"><button type="submit" :disabled="!sessionId">{{ t('go') }}</button></form>
      <button class="toolbar-button muted" :disabled="!sessionId" @click="refresh()">↻ {{ t('refresh') }}</button>
      <button class="toolbar-button" :disabled="!sessionId" @click="chooseUploadFiles">⇧ {{ t('upload') }}</button>
      <button class="toolbar-button" :disabled="!sessionId" @click="chooseUploadFolder">▰ {{ t('uploadFolder') }}</button>
      <button class="toolbar-button" :disabled="!sessionId" @click="createDirectory">＋ {{ t('newFolder') }}</button>
    </div>
    <div v-if="pendingFingerprint" class="terminal-host-key"><span>{{ t('hostKeyPrompt') }}</span><code>{{ t('hostKeyFingerprint') }}: {{ pendingFingerprint }}</code><button class="toolbar-button" @click="trustHostKey">{{ t('trustHostKey') }}</button></div>
    <div v-if="errorMessage" class="sftp-error"><span>{{ errorMessage }}</span><button class="icon-button" @click="errorMessage = ''">×</button><button v-if="!sessionId" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button></div>
    <div class="sftp-table-wrap">
      <table class="sftp-table">
        <thead><tr><th>{{ t('name') }}</th><th>{{ t('size') }}</th><th>{{ t('modified') }}</th><th>{{ t('actions') }}</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="4" class="sftp-empty">{{ t('loading') }}</td></tr>
          <tr v-else-if="!entries.length"><td colspan="4" class="sftp-empty">{{ t('emptyFolder') }}</td></tr>
          <tr v-for="entry in entries" :key="entry.path" @dblclick="openEntry(entry)">
            <td><span class="file-icon">{{ entry.type === 'directory' ? '▰' : entry.type === 'link' ? '↗' : '□' }}</span><button class="file-name" @click="openEntry(entry)">{{ entry.name }}</button></td>
            <td>{{ entry.type === 'directory' ? '—' : formatSize(entry.size) }}</td>
            <td>{{ entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '—' }}</td>
            <td class="file-actions"><button @click="download(entry)">{{ t('download') }}</button><button @click="renameEntry(entry)">{{ t('rename') }}</button><button class="danger" @click="removeEntry(entry)">{{ t('remove') }}</button></td>
          </tr>
        </tbody>
      </table>
      <div class="sftp-drop-hint">{{ t('dropUploadHint') }}</div>
    </div>
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
  </section>
</template>
