<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SftpEntry, SftpTransferEvent } from '../../shared/sftp'
import { joinRemotePath, parentRemotePath } from '../../shared/sftp'
import { t } from '../i18n'

const props = defineProps<{ connectionId: string }>()

const sessionId = ref('')
const path = ref('/')
const pathInput = ref('/')
const entries = ref<SftpEntry[]>([])
const loading = ref(true)
const errorMessage = ref('')
const pendingFingerprint = ref('')
const transfers = ref<Record<string, SftpTransferEvent>>({})
let removeTransferListener: (() => void) | undefined
let disposed = false

function transferEvent(event: SftpTransferEvent): void {
  if (event.sessionId !== sessionId.value) return
  transfers.value[event.transferId] = event
  if (event.status === 'completed' && event.direction === 'upload') void refresh()
}

async function connect(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  pendingFingerprint.value = ''
  if (sessionId.value) await window.api.sftp.disconnect(sessionId.value).catch(() => undefined)
  sessionId.value = ''
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('operationFailed')
  }
}

async function renameEntry(entry: SftpEntry): Promise<void> {
  const name = window.prompt(t('newName'), entry.name)?.trim()
  if (!name || name === entry.name || !sessionId.value) return
  try {
    await window.api.sftp.rename(sessionId.value, entry.path, joinRemotePath(path.value, name))
    await refresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('operationFailed')
  }
}

async function removeEntry(entry: SftpEntry): Promise<void> {
  if (!sessionId.value || !window.confirm(t('deleteRemoteConfirm', { name: entry.name }))) return
  try {
    await window.api.sftp.remove(sessionId.value, entry.path, entry.type)
    await refresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('operationFailed')
  }
}

async function uploadPaths(paths?: string[]): Promise<void> {
  if (!sessionId.value) return
  const selected = paths || await window.api.app.chooseUploadFiles()
  for (const localPath of selected) {
    if (!localPath) continue
    try { await window.api.sftp.upload(sessionId.value, localPath, path.value) } catch (error) { errorMessage.value = error instanceof Error ? error.message : t('operationFailed') }
  }
}

function dropFiles(event: DragEvent): void {
  event.preventDefault()
  const paths = [...(event.dataTransfer?.files || [])].map((file) => window.api.files.getPath(file)).filter(Boolean)
  void uploadPaths(paths)
}

async function download(entry: SftpEntry): Promise<void> {
  if (!sessionId.value || entry.type === 'directory') return
  const localPath = await window.api.app.chooseDownloadPath(entry.name)
  if (!localPath) return
  try { await window.api.sftp.download(sessionId.value, entry.path, localPath, entry.size) } catch (error) { errorMessage.value = error instanceof Error ? error.message : t('operationFailed') }
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatProgress(item: SftpTransferEvent): string {
  if (item.status === 'completed') return t('completed')
  if (item.status === 'error') return item.message || t('operationFailed')
  if (!item.total) return formatSize(item.transferred)
  return `${Math.min(100, Math.round(item.transferred / item.total * 100))}%`
}

onMounted(() => {
  removeTransferListener = window.api.sftp.onTransfer(transferEvent)
  void connect()
})

onBeforeUnmount(() => {
  disposed = true
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
      <button class="toolbar-button" :disabled="!sessionId" @click="uploadPaths()">⇧ {{ t('upload') }}</button>
      <button class="toolbar-button" :disabled="!sessionId" @click="createDirectory">＋ {{ t('newFolder') }}</button>
    </div>
    <div v-if="pendingFingerprint" class="terminal-host-key"><span>{{ t('hostKeyPrompt') }}</span><code>{{ t('hostKeyFingerprint') }}: {{ pendingFingerprint }}</code><button class="toolbar-button" @click="trustHostKey">{{ t('trustHostKey') }}</button></div>
    <div v-if="errorMessage" class="sftp-error"><span>{{ errorMessage }}</span><button v-if="!sessionId" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button></div>
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
            <td class="file-actions"><button v-if="entry.type !== 'directory'" @click="download(entry)">{{ t('download') }}</button><button @click="renameEntry(entry)">{{ t('rename') }}</button><button class="danger" @click="removeEntry(entry)">{{ t('remove') }}</button></td>
          </tr>
        </tbody>
      </table>
      <div class="sftp-drop-hint">{{ t('dropUploadHint') }}</div>
    </div>
    <div v-if="Object.keys(transfers).length" class="transfer-strip">
      <div v-for="item in Object.values(transfers).slice(-4)" :key="item.transferId"><span>{{ item.direction === 'upload' ? '⇧' : '⇩' }} {{ item.name }}</span><strong :class="item.status">{{ formatProgress(item) }}</strong></div>
    </div>
  </section>
</template>
