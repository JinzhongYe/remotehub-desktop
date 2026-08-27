<script setup lang="ts">
import { ref } from 'vue'
import type { Connection, Group } from '../../shared/types'
import { t } from '../i18n'

const props = defineProps<{
  connections: Connection[]
  recentConnections: Connection[]
  groups: Group[]
  selectedId: string | null
  search: string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  select: [id: string]
  create: []
  edit: [connection: Connection]
  remove: [connection: Connection]
  duplicate: [connection: Connection]
  test: [connection: Connection]
  move: [id: string, beforeId?: string, groupId?: string]
  createGroup: []
  editGroup: [group: Group]
  removeGroup: [group: Group]
}>()
const draggedId = ref<string>()

function connectionIcon(connection: Connection): string {
  if (connection.type === 'database') return connection.databaseType === 'postgres' ? 'PG' : connection.databaseType === 'mysql' ? 'MY' : 'DB'
  return '›_'
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
</script>

<template>
  <aside class="explorer">
    <div class="explorer-title">
      <span>{{ t('connections') }}</span>
      <button class="icon-button" :title="t('newConnection')" :aria-label="t('newConnection')" @click="emit('create')">＋</button>
    </div>
    <label class="search-box">
      <span>⌕</span>
      <input id="connection-search" :value="search" :placeholder="t('searchConnections')" @input="emit('update:search', ($event.target as HTMLInputElement).value)">
      <kbd>⌘/Ctrl K</kbd>
    </label>
    <div class="tree-caption"><span>{{ t('myServers') }}</span><span><button class="text-button" @click="emit('createGroup')">{{ t('newGroup') }}</button><button class="text-button" @click="emit('create')">{{ t('add') }}</button></span></div>
    <div v-if="recentConnections.length" class="recent-connections"><span>{{ t('recent') }}</span><button v-for="connection in recentConnections" :key="connection.id" @click="emit('select', connection.id)">{{ connection.name }}</button></div>
    <div v-if="!connections.length && !groups.length" class="empty-explorer">
      <div class="empty-mark">＋</div>
      <p>{{ t('emptyConnections') }}</p>
      <button class="link-button" @click="emit('create')">{{ t('createFirst') }}</button>
    </div>
    <div v-if="groups.length || connections.length" class="connection-tree">
      <details v-for="group in groups" :key="group.id" class="connection-group" open @dragover.prevent @drop="drop(undefined, group.id)">
        <summary class="group-label"><span>{{ group.name }}</span><span class="group-actions"><button :title="t('renameGroup')" @click.stop.prevent="emit('editGroup', group)">✎</button><button :title="t('deleteGroup')" @click.stop.prevent="emit('removeGroup', group)">×</button></span></summary>
        <div v-for="connection in inGroup(group.id)" :key="connection.id" class="connection-row" :class="{ selected: selectedId === connection.id }" role="button" tabindex="0" draggable="true" @dragstart="startDrag($event, connection.id)" @dragover.stop.prevent @drop.stop="drop(connection.id, group.id)" @click="emit('select', connection.id)" @keydown.enter="emit('select', connection.id)">
          <span class="connection-icon" :class="connection.type">{{ connectionIcon(connection) }}</span><span class="connection-copy"><strong>{{ connection.name }}</strong><small>{{ connection.host }}:{{ connection.port }}</small></span><span v-if="connection.favorite" class="favorite">★</span>
          <span class="row-actions"><button class="row-action" :title="t('test')" @click.stop="emit('test', connection)">✓</button><button class="row-action" :title="t('duplicate')" @click.stop="emit('duplicate', connection)">⧉</button><button class="row-action" :title="t('edit')" @click.stop="emit('edit', connection)">⋯</button><button class="row-action danger" :title="t('remove')" @click.stop="emit('remove', connection)">×</button></span>
        </div>
      </details>
      <details class="connection-group" open @dragover.prevent @drop="drop()">
        <summary class="group-label"><span>{{ t('ungrouped') }}</span></summary>
        <div v-for="connection in inGroup()" :key="connection.id" class="connection-row" :class="{ selected: selectedId === connection.id }" role="button" tabindex="0" draggable="true" @dragstart="startDrag($event, connection.id)" @dragover.stop.prevent @drop.stop="drop(connection.id)" @click="emit('select', connection.id)" @keydown.enter="emit('select', connection.id)">
          <span class="connection-icon" :class="connection.type">{{ connectionIcon(connection) }}</span><span class="connection-copy"><strong>{{ connection.name }}</strong><small>{{ connection.host }}:{{ connection.port }}</small></span><span v-if="connection.favorite" class="favorite">★</span>
          <span class="row-actions"><button class="row-action" :title="t('test')" @click.stop="emit('test', connection)">✓</button><button class="row-action" :title="t('duplicate')" @click.stop="emit('duplicate', connection)">⧉</button><button class="row-action" :title="t('edit')" @click.stop="emit('edit', connection)">⋯</button><button class="row-action danger" :title="t('remove')" @click.stop="emit('remove', connection)">×</button></span>
        </div>
      </details>
    </div>
    <div class="explorer-footer">
      <span class="secure-dot"></span>
      <span>{{ t('localSecure') }}</span>
    </div>
  </aside>
</template>
