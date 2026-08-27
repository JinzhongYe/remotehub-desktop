<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConnectionDialog from '../components/ConnectionDialog.vue'
import ConnectionExplorer from '../components/ConnectionExplorer.vue'
import WorkspaceShell from '../components/WorkspaceShell.vue'
import { useConnectionStore } from '../stores/connection'
import { useWorkspaceStore } from '../stores/workspace'
import type { Connection, ConnectionInput } from '../../shared/types'
import type { Group } from '../../shared/types'
import { locale, t, toggleLocale } from '../i18n'

const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()
const dialogOpen = ref(false)
const editing = ref<Connection | null>(null)
const appInfo = ref<{ name: string; version: string; platform: string; dataPath: string } | null>(null)
type MessageKey = Parameters<typeof t>[0]
const statusKey = ref<MessageKey>('initializing')
const statusValues = ref<Record<string, string | number>>({})
const statusError = ref('')
const statusText = computed(() => statusError.value || t(statusKey.value, statusValues.value))
const shortcutModifier = computed(() => appInfo.value?.platform === 'darwin' ? '⌘' : 'Ctrl')

onMounted(async () => {
  try {
    await connectionStore.load()
    appInfo.value = await window.api.app.getInfo()
    setStatus('ready')
  } catch (error) {
    setError(error, 'initFailed')
  }
  window.addEventListener('keydown', handleShortcut)
})
onUnmounted(() => window.removeEventListener('keydown', handleShortcut))

function setStatus(key: MessageKey, values: Record<string, string | number> = {}): void {
  statusError.value = ''
  statusKey.value = key
  statusValues.value = values
}

function setError(error: unknown, fallback: MessageKey): void {
  statusError.value = error instanceof Error ? error.message : t(fallback)
}

function handleShortcut(event: KeyboardEvent): void {
  const modifier = appInfo.value?.platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (!modifier) return
  if (event.key.toLowerCase() === 'k') {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('#connection-search')?.focus()
  } else if (event.key.toLowerCase() === 'n') {
    event.preventDefault()
    openCreate()
  }
}

function openCreate(): void {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(connection: Connection): void {
  editing.value = connection
  dialogOpen.value = true
}

async function saveConnection(input: ConnectionInput, credential?: string, clearCredential?: boolean): Promise<void> {
  try {
    await connectionStore.save(input, credential, clearCredential)
    dialogOpen.value = false
    setStatus('saved')
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

async function removeConnection(connection: Connection): Promise<void> {
  if (!window.confirm(t('deleteConnectionConfirm', { name: connection.name }))) return
  try {
    await connectionStore.remove(connection.id)
    setStatus('deleted')
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

function selectConnection(id: string): void {
  connectionStore.select(id)
  const selected = connectionStore.selected
  if (selected) workspace.openConnection(selected.id, selected.name)
}

async function duplicateConnection(connection: Connection): Promise<void> {
  try {
    await connectionStore.duplicate(connection.id)
    setStatus('duplicated')
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

async function testConnection(connection: Connection): Promise<void> {
  try {
    const result = await connectionStore.test(connection.id)
    setStatus(result.ok ? 'testOk' : 'testFailed', result.ok ? { latency: result.latencyMs } : { code: result.code })
  } catch (error) {
    setError(error, 'testFailed')
  }
}

async function moveConnection(id: string, beforeId?: string, groupId?: string): Promise<void> {
  try {
    await connectionStore.move(id, beforeId, groupId)
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

async function createGroup(): Promise<void> {
  const name = window.prompt(t('groupName'))?.trim()
  if (name) try { await connectionStore.saveGroup(name) } catch (error) { setError(error, 'saveFailed') }
}

async function editGroup(group: Group): Promise<void> {
  const name = window.prompt(t('renameGroupPrompt'), group.name)?.trim()
  if (name) try { await connectionStore.saveGroup(name, group.id) } catch (error) { setError(error, 'saveFailed') }
}

async function removeGroup(group: Group): Promise<void> {
  if (window.confirm(t('deleteGroupConfirm', { name: group.name }))) try { await connectionStore.deleteGroup(group.id) } catch (error) { setError(error, 'saveFailed') }
}
</script>

<template>
  <div class="app-frame">
    <header class="top-toolbar">
      <div class="brand"><span class="brand-mark">RH</span><div><strong>RemoteHub</strong><small>DESKTOP WORKBENCH</small></div></div>
      <div class="toolbar-context"><span class="toolbar-label">{{ t('workspace') }}</span><span class="toolbar-separator">/</span><span>{{ connectionStore.selected?.name || t('noSelection') }}</span></div>
      <div class="toolbar-actions"><button class="toolbar-button" @click="openCreate">＋ {{ t('newConnection') }}</button><button class="toolbar-button muted" @click="toggleLocale">{{ locale === 'zh-CN' ? 'EN' : '中文' }}</button><span class="window-pill">Phase 2</span></div>
    </header>
    <div class="app-body">
      <ConnectionExplorer :connections="connectionStore.filteredConnections" :recent-connections="connectionStore.recentConnections" :groups="connectionStore.groups" :selected-id="connectionStore.selectedId" :search="connectionStore.search" @update:search="connectionStore.search = $event" @select="selectConnection" @create="openCreate" @edit="openEdit" @remove="removeConnection" @duplicate="duplicateConnection" @test="testConnection" @move="moveConnection" @create-group="createGroup" @edit-group="editGroup" @remove-group="removeGroup" />
      <main class="main-workspace"><WorkspaceShell :selected="connectionStore.selected" :shortcut-modifier="shortcutModifier" /></main>
    </div>
    <footer class="status-bar"><span class="status-item"><span class="status-dot"></span>{{ statusText }}</span><span class="status-item">{{ appInfo?.platform || 'desktop' }} · {{ t('localOnly') }}</span><span class="status-item version">{{ appInfo?.version ? `v${appInfo.version}` : 'v0.1.0' }}</span></footer>
    <ConnectionDialog :open="dialogOpen" :connection="editing" :groups="connectionStore.groups" @close="dialogOpen = false" @save="saveConnection" />
  </div>
</template>
