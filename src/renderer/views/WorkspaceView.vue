<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConnectionDialog from '../components/ConnectionDialog.vue'
import ConnectionExplorer from '../components/ConnectionExplorer.vue'
import WorkspaceShell from '../components/WorkspaceShell.vue'
import UiIcon from '../components/UiIcon.vue'
import { useConnectionStore } from '../stores/connection'
import { useWorkspaceStore } from '../stores/workspace'
import type { Connection, ConnectionInput } from '../../shared/types'
import type { Group } from '../../shared/types'
import { loadLocale, locale, t, toggleLocale } from '../i18n'
import { confirmDialog } from '../dialog'
import { connectionLabelColor } from '../connection-color'
import appIcon from '../assets/remotehub-ui.png'
import { appService, getPlatformCapabilities, storageService } from '../../services'
import { useMobileBackLayer } from '../mobile-back'
import { useModalDialog } from '../modal-dialog'

const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()
const capabilities = getPlatformCapabilities()
const mobile = ['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM)
const activeConnectionColor = computed(() => connectionLabelColor(connectionStore.connections, workspace.activeTab?.connectionId))
const dialogOpen = ref(false)
const explorer = ref<InstanceType<typeof ConnectionExplorer> | null>(null)
const connectionSaving = ref(false)
const connectionSaveError = ref('')
const editing = ref<Connection | null>(null)
const groupDialogOpen = ref(false)
const groupModal = useModalDialog()
const editingGroup = ref<Group | null>(null)
const groupName = ref('')
const fullscreen = ref(false)
const appInfo = ref<{ name: string; version: string; platform: string; dataPath: string } | null>(null)
type MessageKey = Parameters<typeof t>[0]
const statusKey = ref<MessageKey>('initializing')
const statusValues = ref<Record<string, string | number>>({})
const statusError = ref('')
const statusText = computed(() => statusError.value || t(statusKey.value, statusValues.value))
const shortcutModifier = computed(() => appInfo.value?.platform === 'darwin' ? '⌘' : 'Ctrl')
type Theme = 'light' | 'dark' | 'tokyo-night' | 'tokyo-storm' | 'tokyo-light'
const themeMenu = ref<HTMLDetailsElement | null>(null)
const themeMenuOpen = ref(false)
const themeOptions = computed(() => [
  { value: 'dark', label: t('darkMode') }, { value: 'light', label: t('lightMode') },
  { value: 'tokyo-night', label: 'Tokyo Night' }, { value: 'tokyo-storm', label: 'Tokyo Storm' },
  { value: 'tokyo-light', label: 'Tokyo Light' }
] as const)
const theme = ref<Theme>(matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
let removeFullscreenListener: (() => void) | undefined
document.documentElement.dataset.theme = theme.value
useMobileBackLayer(() => groupDialogOpen.value, () => { groupDialogOpen.value = false })
useMobileBackLayer(() => themeMenuOpen.value, closeThemeMenu)

function closeThemeMenu(): void {
  if (themeMenu.value) themeMenu.value.open = false
}
function dismissThemeMenu(event: PointerEvent): void {
  if (!themeMenu.value?.contains(event.target as Node)) closeThemeMenu()
}
function navigateThemeMenu(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeThemeMenu()
    themeMenu.value?.querySelector('summary')?.focus()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const buttons = [...(themeMenu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const target = event.key === 'ArrowDown' ? (index + 1) % buttons.length
    : event.key === 'ArrowUp' ? (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length)
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
  if (target < 0 || !buttons.length) return
  if (themeMenu.value) themeMenu.value.open = true
  buttons[target].focus()
  event.preventDefault()
}

function applyTheme(): void {
  document.documentElement.dataset.theme = theme.value
  void storageService.set('remotehub.theme', theme.value).catch(() => undefined)
  void appService.setTheme(theme.value).catch(() => undefined)
}

onMounted(async () => {
  document.addEventListener('pointerdown', dismissThemeMenu)
  removeFullscreenListener = appService.onFullscreenChange((value) => { fullscreen.value = value })
  try {
    const [savedTheme, serializedWorkspace, legacySftpOpen, legacySftpPosition] = await Promise.all([
      storageService.get('remotehub.theme'),
      storageService.get('remotehub.workspace'),
      storageService.get('remotehub.sftpOpen'),
      storageService.get('remotehub.sftpPosition'),
      loadLocale()
    ])
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'tokyo-night' || savedTheme === 'tokyo-storm' || savedTheme === 'tokyo-light') theme.value = savedTheme
    document.documentElement.dataset.theme = theme.value
    void appService.setTheme(theme.value).catch(() => undefined)
    if (capabilities.connectionManagement) await connectionStore.load()
    workspace.restore(connectionStore.connections.map((connection) => connection.id), serializedWorkspace, { sftpOpen: legacySftpOpen, sftpPosition: legacySftpPosition })
    appInfo.value = await appService.getInfo()
    setStatus('ready')
  } catch (error) {
    setError(error, 'initFailed')
  }
  window.addEventListener('keydown', handleShortcut)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleShortcut)
  document.removeEventListener('pointerdown', dismissThemeMenu)
  removeFullscreenListener?.()
})

function setStatus(key: MessageKey, values: Record<string, string | number> = {}): void {
  statusError.value = ''
  statusKey.value = key
  statusValues.value = values
}

function setError(error: unknown, fallback: MessageKey): void {
  statusError.value = error instanceof Error ? error.message : t(fallback)
}

function handleShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return
  const modifier = appInfo.value?.platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (!modifier) return
  if (event.key.toLowerCase() === 'k') {
    event.preventDefault()
    explorer.value?.focusSearch()
  } else if (event.key.toLowerCase() === 'n') {
    if (!capabilities.connectionManagement) return
    event.preventDefault()
    openCreate()
  }
}

function openCreate(): void {
  connectionSaveError.value = ''
  editing.value = null
  dialogOpen.value = true
}

function openEdit(connection: Connection): void {
  connectionSaveError.value = ''
  editing.value = connection
  dialogOpen.value = true
}

async function saveConnection(input: ConnectionInput, credential?: string, clearCredential?: boolean, privateKeyPath?: string, passphrase?: string, clearPassphrase?: boolean): Promise<void> {
  if (connectionSaving.value) return
  connectionSaving.value = true
  connectionSaveError.value = ''
  try {
    await connectionStore.save(input, credential, clearCredential, privateKeyPath, passphrase, clearPassphrase)
    dialogOpen.value = false
    setStatus('saved')
  } catch (error) {
    connectionSaveError.value = error instanceof Error ? error.message : t('saveFailed')
    setError(error, 'saveFailed')
  } finally { connectionSaving.value = false }
}

async function removeConnection(connection: Connection): Promise<void> {
  if (!await confirmDialog({ title: t('confirmTitle'), message: t('deleteConnectionConfirm', { name: connection.name }), confirmText: t('remove'), danger: true })) return
  try {
    if (!await workspace.removeConnection(connection.id)) return
    await connectionStore.remove(connection.id)
    setStatus('deleted')
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

function selectConnection(id: string): void {
  connectionStore.select(id)
  const selected = connectionStore.selected
  if (selected) workspace.openConnection(selected.id, selected.name, selected.type === 'database' ? 'sql' : selected.type === 'ftp' ? 'sftp' : 'terminal', { sftpOpen: mobile ? false : undefined })
}

function openSftp(connection: Connection): void {
  connectionStore.select(connection.id)
  workspace.openConnection(connection.id, capabilities.localFiles ? `${connection.name} · SFTP` : connection.name, capabilities.localFiles ? 'sftp' : 'terminal', { sftpOpen: mobile })
}

async function duplicateConnection(connection: Connection): Promise<void> {
  try {
    await connectionStore.duplicate(connection.id)
    setStatus('duplicated')
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

async function importConnections(): Promise<void> {
  try {
    const result = await connectionStore.importConnections()
    if (!result.canceled) setStatus('importedConnections', { count: result.count })
  } catch (error) { setError(error, 'importFailed') }
}

async function exportConnections(): Promise<void> {
  try {
    const result = await connectionStore.exportConnections()
    if (!result.canceled) setStatus('exportedConnections', { count: result.count })
  } catch (error) { setError(error, 'exportFailed') }
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

async function moveGroup(id: string, targetId: string, after: boolean): Promise<void> {
  try {
    await connectionStore.moveGroup(id, targetId, after)
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

function createGroup(): void {
  editingGroup.value = null
  groupName.value = ''
  groupDialogOpen.value = true
}

function editGroup(group: Group): void {
  editingGroup.value = group
  groupName.value = group.name
  groupDialogOpen.value = true
}

async function saveGroup(): Promise<void> {
  const name = groupName.value.trim()
  if (!name) return
  try {
    await connectionStore.saveGroup(name, editingGroup.value?.id)
    groupDialogOpen.value = false
    setStatus('saved')
  } catch (error) {
    setError(error, 'saveFailed')
  }
}

async function removeGroup(group: Group): Promise<void> {
  if (await confirmDialog({ title: t('confirmTitle'), message: t('deleteGroupConfirm', { name: group.name }), confirmText: t('remove'), danger: true })) try { await connectionStore.deleteGroup(group.id) } catch (error) { setError(error, 'saveFailed') }
}
</script>

<template>
  <div class="app-frame" :class="{ darwin: appInfo?.platform === 'darwin', fullscreen }">
    <header class="top-toolbar">
      <div class="brand"><button class="brand-home" :aria-label="t('workspace')" :title="t('workspace')" @click="workspace.activate('welcome')"><img class="brand-mark" :src="appIcon" alt=""></button><div><strong>RemoteHub</strong><small>DESKTOP WORKBENCH</small></div></div>
      <div class="toolbar-context" :style="{ '--workspace-color': activeConnectionColor }"><button class="toolbar-label" @click="workspace.activate('welcome')">{{ t('workspace') }}</button><span class="toolbar-separator">/</span><span>{{ workspace.activeTab?.title }}</span></div>
      <div class="toolbar-actions">
        <button v-if="capabilities.connectionManagement" class="toolbar-button new-connection-button" :aria-label="t('newConnection')" @click="openCreate"><UiIcon name="plus" /><span>{{ t('newConnection') }}</span></button>
        <select v-model="theme" class="theme-select" :aria-label="t('themeLabel')" :title="t('themeLabel')" @change="applyTheme"><option v-for="option in themeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        <details ref="themeMenu" class="theme-menu" @toggle="themeMenuOpen = ($event.target as HTMLDetailsElement).open" @keydown="navigateThemeMenu">
          <summary class="toolbar-button muted icon-only" :aria-label="t('themeLabel')" :title="t('themeLabel')"><UiIcon name="palette" /></summary>
          <div role="menu" :aria-label="t('themeLabel')"><button v-for="option in themeOptions" :key="option.value" role="menuitemradio" :aria-checked="theme === option.value" @click="theme = option.value; applyTheme(); closeThemeMenu()">{{ option.label }}</button></div>
        </details>
        <button class="toolbar-button muted" @click="toggleLocale">{{ locale === 'zh-CN' ? 'EN' : '中文' }}</button>
      </div>
    </header>
    <div class="app-body">
      <ConnectionExplorer ref="explorer" :connections="connectionStore.filteredConnections" :groups="connectionStore.groups" :selected-id="connectionStore.selectedId" :search="connectionStore.search" :manageable="capabilities.connectionManagement" :sftp="capabilities.sftp" :import-export="capabilities.localFiles" @update:search="connectionStore.search = $event" @select="selectConnection" @sftp="openSftp" @create="openCreate" @edit="openEdit" @remove="removeConnection" @duplicate="duplicateConnection" @import-connections="importConnections" @export-connections="exportConnections" @test="testConnection" @move="moveConnection" @move-group="moveGroup" @create-group="createGroup" @edit-group="editGroup" @remove-group="removeGroup" />
      <main class="main-workspace"><WorkspaceShell :shortcut-modifier="shortcutModifier" /></main>
    </div>
    <footer class="status-bar"><span class="status-item status-message" role="status" :title="statusText"><span class="status-dot"></span><span>{{ statusText }}</span></span><span class="status-item">{{ appInfo?.platform || 'desktop' }} · {{ t('localOnly') }}</span><span class="status-item version">{{ appInfo?.version ? `v${appInfo.version}` : 'v0.1.0' }}</span></footer>
    <ConnectionDialog :open="dialogOpen" :connection="editing" :groups="connectionStore.groups" :connections="connectionStore.connections" :platform="appInfo?.platform" :capabilities="capabilities" :saving="connectionSaving" :save-error="connectionSaveError" @close="dialogOpen = false" @save="saveConnection" />
    <dialog v-if="groupDialogOpen" ref="groupModal" class="modal-layer" aria-labelledby="group-dialog-title" @click.self="groupDialogOpen = false" @cancel.prevent="groupDialogOpen = false">
      <form class="connection-dialog" @submit.prevent="saveGroup">
        <div class="dialog-heading"><div><span class="eyebrow">{{ t('group') }}</span><h2 id="group-dialog-title">{{ editingGroup ? t('renameGroup') : t('newGroup') }}</h2></div><button type="button" class="icon-button" :aria-label="t('cancel')" @click="groupDialogOpen = false">×</button></div>
        <label class="field"><span>{{ t('groupName') }}</span><input v-model="groupName" required maxlength="80" autofocus></label>
        <div class="dialog-actions"><button type="button" class="button secondary" @click="groupDialogOpen = false">{{ t('cancel') }}</button><button type="submit" class="button primary">{{ editingGroup ? t('renameGroup') : t('newGroup') }}</button></div>
      </form>
    </dialog>
  </div>
</template>
