<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { Connection, Group } from '../../shared/types'
import { t } from '../i18n'
import ConnectionIcon from './ConnectionIcon.vue'
import UiIcon from './UiIcon.vue'

const props = defineProps<{
  connections: Connection[]
  groups: Group[]
  selectedId: string | null
  search: string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  select: [id: string]
  sftp: [connection: Connection]
  create: []
  edit: [connection: Connection]
  remove: [connection: Connection]
  duplicate: [connection: Connection]
  test: [connection: Connection]
  move: [id: string, beforeId?: string, groupId?: string]
  createGroup: []
  importConnections: []
  exportConnections: []
  editGroup: [group: Group]
  removeGroup: [group: Group]
}>()
const draggedId = ref<string>()
const contextMenu = ref<{ connection: Connection; x: number; y: number }>()
const collapsed = ref(false)

onMounted(() => window.addEventListener('click', closeContextMenu))
onUnmounted(() => window.removeEventListener('click', closeContextMenu))

function connectionSubtitle(connection: Connection): string {
  return connection.type === 'shell' ? connection.host : connection.type === 'serial' ? `${connection.host} · ${connection.port} baud` : `${connection.host}:${connection.port}`
}

function inGroup(groupId?: string): Connection[] {
  return props.connections.filter((item) => item.groupId === groupId || (!groupId && !item.groupId))
}

function startDrag(event: DragEvent, id: string): void {
  draggedId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function drop(beforeId?: string, groupId?: string): void {
  if (draggedId.value) emit('move', draggedId.value, beforeId, groupId)
  draggedId.value = undefined
}

function openContextMenu(event: MouseEvent, connection: Connection): void {
  contextMenu.value = { connection, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 250) }
}

function closeContextMenu(): void {
  contextMenu.value = undefined
}

function run(action: 'select' | 'sftp' | 'edit' | 'test' | 'duplicate' | 'remove'): void {
  const connection = contextMenu.value?.connection
  if (!connection) return
  if (action === 'select') emit('select', connection.id)
  else if (action === 'sftp') emit('sftp', connection)
  else if (action === 'edit') emit('edit', connection)
  else if (action === 'test') emit('test', connection)
  else if (action === 'duplicate') emit('duplicate', connection)
  else emit('remove', connection)
  closeContextMenu()
}
</script>

<template>
  <aside class="explorer" :class="{ collapsed }">
    <div class="explorer-title">
      <span v-if="!collapsed">{{ t('connections') }}</span>
      <span class="explorer-actions"><button v-if="!collapsed" class="icon-button" :title="t('importConnections')" :aria-label="t('importConnections')" @click="emit('importConnections')"><UiIcon name="download" /></button><button v-if="!collapsed" class="icon-button" :title="t('exportConnections')" :aria-label="t('exportConnections')" @click="emit('exportConnections')"><UiIcon name="upload" /></button><button v-if="!collapsed" class="icon-button" :title="t('newConnection')" :aria-label="t('newConnection')" @click="emit('create')"><UiIcon name="plus" /></button><button class="icon-button" :title="t(collapsed ? 'expandConnections' : 'collapseConnections')" :aria-label="t(collapsed ? 'expandConnections' : 'collapseConnections')" @click="collapsed = !collapsed"><UiIcon :name="collapsed ? 'chevronRight' : 'chevronLeft'" /></button></span>
    </div>
    <template v-if="!collapsed">
    <label class="search-box">
      <UiIcon name="search" :size="14" />
      <input id="connection-search" :value="search" :placeholder="t('searchConnections')" @input="emit('update:search', ($event.target as HTMLInputElement).value)">
      <kbd>⌘/Ctrl K</kbd>
    </label>
    <div class="tree-caption"><span>{{ t('myServers') }}</span><span><button class="text-button" @click="emit('createGroup')">{{ t('newGroup') }}</button><button class="text-button" @click="emit('create')">{{ t('add') }}</button></span></div>
    <div v-if="!connections.length && !groups.length" class="empty-explorer">
      <div class="empty-mark"><UiIcon name="plus" :size="20" /></div>
      <p>{{ t('emptyConnections') }}</p>
      <button class="link-button" @click="emit('create')">{{ t('createFirst') }}</button>
    </div>
    <div v-if="groups.length || connections.length" class="connection-tree">
      <details v-for="group in groups" :key="group.id" class="connection-group" open @dragover.prevent @drop="drop(undefined, group.id)">
        <summary class="group-label"><span class="group-icon"><UiIcon name="folder" /></span><strong>{{ group.name }}</strong><small>{{ inGroup(group.id).length }}</small><span class="group-actions"><button :title="t('renameGroup')" :aria-label="t('renameGroup')" @click.stop.prevent="emit('editGroup', group)"><UiIcon name="edit" :size="14" /></button><button :title="t('deleteGroup')" :aria-label="t('deleteGroup')" @click.stop.prevent="emit('removeGroup', group)"><UiIcon name="close" :size="14" /></button></span></summary>
        <div v-for="connection in inGroup(group.id)" :key="connection.id" class="connection-row" :class="{ selected: selectedId === connection.id }" role="button" tabindex="0" draggable="true" :title="t('doubleClick')" @dragstart="startDrag($event, connection.id)" @dragover.stop.prevent @drop.stop="drop(connection.id, group.id)" @dblclick="emit('select', connection.id)" @contextmenu.prevent="openContextMenu($event, connection)" @keydown.enter="emit('select', connection.id)">
          <ConnectionIcon :connection="connection" /><span class="connection-copy"><strong>{{ connection.name }}</strong><small>{{ connectionSubtitle(connection) }}</small></span><span v-if="connection.favorite" class="favorite"><UiIcon name="star" :size="13" /></span>
        </div>
      </details>
      <details class="connection-group" open @dragover.prevent @drop="drop()">
        <summary class="group-label"><span class="group-icon"><UiIcon name="folder" /></span><strong>{{ t('ungrouped') }}</strong><small>{{ inGroup().length }}</small></summary>
        <div v-for="connection in inGroup()" :key="connection.id" class="connection-row" :class="{ selected: selectedId === connection.id }" role="button" tabindex="0" draggable="true" :title="t('doubleClick')" @dragstart="startDrag($event, connection.id)" @dragover.stop.prevent @drop.stop="drop(connection.id)" @dblclick="emit('select', connection.id)" @contextmenu.prevent="openContextMenu($event, connection)" @keydown.enter="emit('select', connection.id)">
          <ConnectionIcon :connection="connection" /><span class="connection-copy"><strong>{{ connection.name }}</strong><small>{{ connectionSubtitle(connection) }}</small></span><span v-if="connection.favorite" class="favorite"><UiIcon name="star" :size="13" /></span>
        </div>
      </details>
    </div>
    <div class="explorer-footer">
      <span class="secure-dot"></span>
      <span>{{ t('localSecure') }}</span>
    </div>
    <div v-if="contextMenu" class="connection-context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button @click="run('select')">{{ t('connect') }}</button>
      <button @click="run('edit')">{{ t('edit') }}</button>
      <button v-if="contextMenu.connection.type === 'ssh'" @click="run('sftp')">SFTP</button>
      <button @click="run('test')">{{ t('test') }}</button>
      <button @click="run('duplicate')">{{ t('duplicate') }}</button>
      <button class="danger" @click="run('remove')">{{ t('remove') }}</button>
    </div>
    </template>
  </aside>
</template>
