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
  moveGroup: [id: string, targetId: string, after: boolean]
  createGroup: []
  importConnections: []
  exportConnections: []
  editGroup: [group: Group]
  removeGroup: [group: Group]
}>()
const draggedId = ref<string>()
const draggedGroupId = ref<string>()
const groupDrop = ref<{ id: string; after: boolean }>()
const connectionTree = ref<HTMLElement | null>(null)
let dragScrollFrame: number | undefined
let dragClientY = 0
const contextMenu = ref<{ connection: Connection; x: number; y: number }>()
const collapsed = ref(false)

onMounted(() => window.addEventListener('click', closeContextMenu))
onUnmounted(() => { window.removeEventListener('click', closeContextMenu); finishDrag() })

function connectionSubtitle(connection: Connection): string {
  return connection.type === 'shell' ? connection.host : connection.type === 'serial' ? `${connection.host} · ${connection.port} baud` : `${connection.host}:${connection.port}`
}

function inGroup(groupId?: string): Connection[] {
  return props.connections.filter((item) => item.groupId === groupId || (!groupId && !item.groupId))
}

function startDrag(event: DragEvent, id: string): void {
  if (!event.dataTransfer) { event.preventDefault(); return }
  finishDrag()
  draggedId.value = id
  event.dataTransfer.setData('application/x-remotehub-asset', id)
  event.dataTransfer.effectAllowed = 'move'
}

function startGroupDrag(event: DragEvent, id: string): void {
  if (!event.dataTransfer || (event.target as HTMLElement).closest('button')) { event.preventDefault(); return }
  finishDrag()
  closeContextMenu()
  draggedGroupId.value = id
  event.dataTransfer.setData('application/x-remotehub-group', id)
  event.dataTransfer.effectAllowed = 'move'
}

function finishDrag(): void {
  draggedId.value = undefined
  draggedGroupId.value = undefined
  groupDrop.value = undefined
  if (dragScrollFrame !== undefined) window.cancelAnimationFrame(dragScrollFrame)
  dragScrollFrame = undefined
}

function allowAssetDrop(event: DragEvent): void {
  if (!draggedId.value) return
  event.preventDefault()
  event.stopPropagation()
  scrollTreeDuringDrag(event)
}

function dropAsset(event: DragEvent, beforeId?: string, groupId?: string): void {
  if (!draggedId.value) return
  event.preventDefault()
  event.stopPropagation()
  if (draggedId.value) emit('move', draggedId.value, beforeId, groupId)
  finishDrag()
}

function groupPlacement(event: DragEvent, id?: string): { id: string; after: boolean } | undefined {
  if (!id) {
    const last = props.groups.at(-1)
    return last ? { id: last.id, after: true } : undefined
  }
  const summary = (event.currentTarget as HTMLElement).querySelector('summary')
  if (!summary) return undefined
  const bounds = summary.getBoundingClientRect()
  return { id, after: event.clientY >= bounds.top + bounds.height / 2 }
}

function dragOverGroup(event: DragEvent, id?: string): void {
  if (!draggedGroupId.value && !draggedId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  groupDrop.value = draggedGroupId.value ? groupPlacement(event, id) : undefined
}

function dropGroup(event: DragEvent, id?: string): void {
  if (draggedGroupId.value) {
    event.preventDefault()
    const target = groupPlacement(event, id)
    if (target && target.id !== draggedGroupId.value) emit('moveGroup', draggedGroupId.value, target.id, target.after)
    finishDrag()
  } else dropAsset(event, undefined, id)
}

function moveGroupWithKeyboard(event: KeyboardEvent, id: string): void {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || (event.target as HTMLElement).closest('button')) return
  event.preventDefault()
  const after = event.key === 'ArrowDown'
  const target = props.groups[props.groups.findIndex(group => group.id === id) + (after ? 1 : -1)]
  if (target) emit('moveGroup', id, target.id, after)
}

function scrollTreeDuringDrag(event: DragEvent): void {
  if (!draggedId.value && !draggedGroupId.value) return
  dragClientY = event.clientY
  if (dragScrollFrame === undefined) dragScrollFrame = window.requestAnimationFrame(scrollTree)
}

function leaveTree(event: DragEvent): void {
  if (event.relatedTarget instanceof Node && connectionTree.value?.contains(event.relatedTarget)) return
  groupDrop.value = undefined
  if (dragScrollFrame !== undefined) window.cancelAnimationFrame(dragScrollFrame)
  dragScrollFrame = undefined
}

function scrollTree(): void {
  dragScrollFrame = undefined
  if ((!draggedId.value && !draggedGroupId.value) || !connectionTree.value) return
  const bounds = connectionTree.value.getBoundingClientRect()
  const speed = dragClientY < bounds.top + 28 ? -10 : dragClientY > bounds.bottom - 28 ? 10 : 0
  if (speed) {
    connectionTree.value.scrollTop += speed
    dragScrollFrame = window.requestAnimationFrame(scrollTree)
  }
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
    <div v-if="groups.length || connections.length" ref="connectionTree" class="connection-tree" @dragover="scrollTreeDuringDrag" @dragleave="leaveTree">
      <details v-for="group in groups" :key="group.id" class="connection-group" :class="{ 'group-dragging': draggedGroupId === group.id, 'group-drop-before': groupDrop?.id === group.id && !groupDrop.after && draggedGroupId !== group.id, 'group-drop-after': groupDrop?.id === group.id && groupDrop.after && draggedGroupId !== group.id }" :data-group-id="group.id" open @dragover="dragOverGroup($event, group.id)" @drop="dropGroup($event, group.id)">
        <summary class="group-label draggable-group" draggable="true" :title="t('dragGroup')" @dragstart="startGroupDrag($event, group.id)" @dragend="finishDrag" @keydown="moveGroupWithKeyboard($event, group.id)"><span class="group-icon"><UiIcon name="folder" /></span><strong>{{ group.name }}</strong><small>{{ inGroup(group.id).length }}</small><span class="group-actions"><button :title="t('renameGroup')" :aria-label="t('renameGroup')" @click.stop.prevent="emit('editGroup', group)"><UiIcon name="edit" :size="14" /></button><button :title="t('deleteGroup')" :aria-label="t('deleteGroup')" @click.stop.prevent="emit('removeGroup', group)"><UiIcon name="close" :size="14" /></button></span></summary>
        <div v-for="connection in inGroup(group.id)" :key="connection.id" class="connection-row" :class="{ selected: selectedId === connection.id }" role="button" tabindex="0" draggable="true" :title="t('doubleClick')" @dragstart="startDrag($event, connection.id)" @dragend="finishDrag" @dragover="allowAssetDrop" @drop="dropAsset($event, connection.id, group.id)" @dblclick="emit('select', connection.id)" @contextmenu.prevent="openContextMenu($event, connection)" @keydown.enter="emit('select', connection.id)">
          <ConnectionIcon :connection="connection" /><span class="connection-copy"><strong>{{ connection.name }}</strong><small>{{ connectionSubtitle(connection) }}</small></span><span v-if="connection.favorite" class="favorite"><UiIcon name="star" :size="13" /></span>
        </div>
      </details>
      <details class="connection-group" open @dragover="dragOverGroup($event)" @drop="dropGroup($event)">
        <summary class="group-label"><span class="group-icon"><UiIcon name="folder" /></span><strong>{{ t('ungrouped') }}</strong><small>{{ inGroup().length }}</small></summary>
        <div v-for="connection in inGroup()" :key="connection.id" class="connection-row" :class="{ selected: selectedId === connection.id }" role="button" tabindex="0" draggable="true" :title="t('doubleClick')" @dragstart="startDrag($event, connection.id)" @dragend="finishDrag" @dragover="allowAssetDrop" @drop="dropAsset($event, connection.id)" @dblclick="emit('select', connection.id)" @contextmenu.prevent="openContextMenu($event, connection)" @keydown.enter="emit('select', connection.id)">
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
