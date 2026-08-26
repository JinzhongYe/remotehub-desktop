<script setup lang="ts">
import type { Connection, Group } from '../../shared/types'

defineProps<{
  connections: Connection[]
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
}>()

function connectionIcon(connection: Connection): string {
  if (connection.type === 'database') return connection.databaseType === 'postgres' ? 'PG' : connection.databaseType === 'mysql' ? 'MY' : 'DB'
  return '›_'
}
</script>

<template>
  <aside class="explorer">
    <div class="explorer-title">
      <span>连接</span>
      <button class="icon-button" title="新增连接" @click="emit('create')">＋</button>
    </div>
    <label class="search-box">
      <span>⌕</span>
      <input :value="search" placeholder="搜索连接" @input="emit('update:search', ($event.target as HTMLInputElement).value)">
      <kbd>⌘ K</kbd>
    </label>
    <div class="tree-caption"><span>我的服务器</span><button class="text-button" @click="emit('create')">新增</button></div>
    <div v-if="!connections.length" class="empty-explorer">
      <div class="empty-mark">＋</div>
      <p>还没有连接资产</p>
      <button class="link-button" @click="emit('create')">创建第一个连接</button>
    </div>
    <div v-else class="connection-tree">
      <div v-for="group in groups" :key="group.id" class="group-label">{{ group.name }}</div>
      <button
        v-for="connection in connections"
        :key="connection.id"
        class="connection-row"
        :class="{ selected: selectedId === connection.id }"
        @click="emit('select', connection.id)"
        @dblclick="emit('edit', connection)"
      >
        <span class="connection-icon" :class="connection.type">{{ connectionIcon(connection) }}</span>
        <span class="connection-copy">
          <strong>{{ connection.name }}</strong>
          <small>{{ connection.host }}:{{ connection.port }}</small>
        </span>
        <span v-if="connection.favorite" class="favorite">★</span>
        <span class="row-actions">
          <button class="row-action" title="编辑" @click.stop="emit('edit', connection)">⋯</button>
        </span>
      </button>
    </div>
    <div class="explorer-footer">
      <span class="secure-dot"></span>
      <span>本地存储 · 凭据不入库</span>
    </div>
  </aside>
</template>
