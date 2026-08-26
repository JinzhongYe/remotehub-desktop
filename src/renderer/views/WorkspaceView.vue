<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ConnectionDialog from '../components/ConnectionDialog.vue'
import ConnectionExplorer from '../components/ConnectionExplorer.vue'
import WorkspaceShell from '../components/WorkspaceShell.vue'
import { useConnectionStore } from '../stores/connection'
import { useWorkspaceStore } from '../stores/workspace'
import type { Connection, ConnectionInput } from '../../shared/types'

const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()
const dialogOpen = ref(false)
const editing = ref<Connection | null>(null)
const appInfo = ref<{ name: string; version: string; platform: string; dataPath: string } | null>(null)
const statusText = ref('正在初始化…')

onMounted(async () => {
  try {
    await connectionStore.load()
    appInfo.value = await window.api.app.getInfo()
    statusText.value = 'Ready'
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : '初始化失败'
  }
})

function openCreate(): void {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(connection: Connection): void {
  editing.value = connection
  dialogOpen.value = true
}

async function saveConnection(input: ConnectionInput): Promise<void> {
  try {
    await connectionStore.save(input)
    dialogOpen.value = false
    statusText.value = '连接资产已保存'
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : '保存失败'
  }
}

async function removeConnection(connection: Connection): Promise<void> {
  if (!window.confirm(`删除连接“${connection.name}”？`)) return
  await connectionStore.remove(connection.id)
  statusText.value = '连接资产已删除'
}

function selectConnection(id: string): void {
  connectionStore.select(id)
  const selected = connectionStore.selected
  if (selected) workspace.openConnection(selected.id, selected.name)
}
</script>

<template>
  <div class="app-frame">
    <header class="top-toolbar">
      <div class="brand"><span class="brand-mark">RH</span><div><strong>RemoteHub</strong><small>DESKTOP WORKBENCH</small></div></div>
      <div class="toolbar-context"><span class="toolbar-label">WORKSPACE</span><span class="toolbar-separator">/</span><span>{{ connectionStore.selected?.name || '未选择连接' }}</span></div>
      <div class="toolbar-actions"><button class="toolbar-button" @click="openCreate">＋ 新建连接</button><button class="toolbar-button muted">设置</button><span class="window-pill">Phase 0</span></div>
    </header>
    <div class="app-body">
      <ConnectionExplorer :connections="connectionStore.filteredConnections" :groups="connectionStore.groups" :selected-id="connectionStore.selectedId" :search="connectionStore.search" @update:search="connectionStore.search = $event" @select="selectConnection" @create="openCreate" @edit="openEdit" @remove="removeConnection" />
      <main class="main-workspace"><WorkspaceShell :selected="connectionStore.selected" /></main>
    </div>
    <footer class="status-bar"><span class="status-item"><span class="status-dot"></span>{{ statusText }}</span><span class="status-item">{{ appInfo?.platform || 'desktop' }} · local only</span><span class="status-item version">{{ appInfo?.version ? `v${appInfo.version}` : 'v0.1.0' }}</span></footer>
    <ConnectionDialog :open="dialogOpen" :connection="editing" @close="dialogOpen = false" @save="saveConnection" />
  </div>
</template>
