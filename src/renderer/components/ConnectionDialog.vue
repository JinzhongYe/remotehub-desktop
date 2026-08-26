<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { Connection, ConnectionInput } from '../../shared/types'

const props = defineProps<{ open: boolean; connection?: Connection | null }>()
const emit = defineEmits<{ close: []; save: [value: ConnectionInput] }>()

const form = reactive<ConnectionInput>({ name: '', type: 'ssh', host: '', port: 22, username: '', authType: 'privateKey', databaseType: 'postgres', database: '', favorite: false })

watch(() => [props.open, props.connection], () => {
  const item = props.connection
  form.id = item?.id
  form.name = item?.name || ''
  form.type = item?.type || 'ssh'
  form.host = item?.host || ''
  form.port = item?.port || (form.type === 'database' ? 5432 : 22)
  form.username = item?.username || ''
  form.authType = item?.authType || 'privateKey'
  form.databaseType = item?.databaseType || 'postgres'
  form.database = item?.database || ''
  form.groupId = item?.groupId
  form.favorite = item?.favorite || false
}, { immediate: true })

function submit(): void {
  emit('save', { ...form, name: form.name.trim(), host: form.host.trim(), username: form.username?.trim() })
}

function changeType(): void {
  if (form.type === 'database' && form.port === 22) form.port = 5432
  if (form.type === 'ssh' && form.port === 5432) form.port = 22
}
</script>

<template>
  <div v-if="open" class="modal-layer" @click.self="emit('close')">
    <form class="connection-dialog" @submit.prevent="submit">
      <div class="dialog-heading">
        <div><span class="eyebrow">CONNECTION ASSET</span><h2>{{ connection ? '编辑连接' : '新增连接' }}</h2></div>
        <button type="button" class="icon-button" @click="emit('close')">×</button>
      </div>
      <div class="dialog-grid">
        <label class="field wide"><span>名称</span><input v-model="form.name" required placeholder="测试服务器 / MES PG"></label>
        <label class="field"><span>类型</span><select v-model="form.type" @change="changeType"><option value="ssh">SSH服务器</option><option value="database">数据库</option></select></label>
        <label class="field"><span>端口</span><input v-model.number="form.port" type="number" min="1" max="65535" required></label>
        <label class="field wide"><span>主机地址</span><input v-model="form.host" required placeholder="192.168.1.100 或 db.example.com"></label>
        <label class="field"><span>用户名</span><input v-model="form.username" placeholder="可选"></label>
        <label class="field"><span>认证方式</span><select v-model="form.authType"><option value="privateKey">Private Key</option><option value="password">密码（凭据库）</option></select></label>
        <template v-if="form.type === 'database'">
          <label class="field"><span>数据库类型</span><select v-model="form.databaseType"><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="sqlite">SQLite</option></select></label>
          <label class="field"><span>默认数据库</span><input v-model="form.database" placeholder="可选"></label>
        </template>
      </div>
      <label class="favorite-check"><input v-model="form.favorite" type="checkbox"><span>加入收藏</span></label>
      <p class="dialog-note">密码、Token 和私钥口令将在后续连接阶段写入系统凭据库；本地 SQLite 只保存引用标识。</p>
      <div class="dialog-actions"><button type="button" class="button secondary" @click="emit('close')">取消</button><button type="submit" class="button primary">保存连接</button></div>
    </form>
  </div>
</template>
