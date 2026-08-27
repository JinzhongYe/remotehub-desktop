<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { Connection, ConnectionInput, Group } from '../../shared/types'
import { t } from '../i18n'

const props = defineProps<{ open: boolean; connection?: Connection | null; groups: Group[] }>()
const emit = defineEmits<{ close: []; save: [value: ConnectionInput, credential?: string, clearCredential?: boolean] }>()

const form = reactive<ConnectionInput>({ name: '', type: 'ssh', host: '', port: 22, username: '', authType: 'privateKey', databaseType: 'postgres', database: '', favorite: false })
const credential = ref('')
const clearCredential = ref(false)

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
  form.credentialId = item?.credentialId
  form.groupId = item?.groupId
  form.favorite = item?.favorite || false
  form.sortOrder = item?.sortOrder
  credential.value = ''
  clearCredential.value = false
}, { immediate: true })

function submit(): void {
  emit('save', { ...form, name: form.name.trim(), host: form.host.trim(), username: form.username?.trim() }, credential.value || undefined, clearCredential.value)
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
        <div><span class="eyebrow">{{ t('connectionAsset') }}</span><h2>{{ connection ? t('editConnection') : t('newConnection') }}</h2></div>
        <button type="button" class="icon-button" :aria-label="t('cancel')" @click="emit('close')">×</button>
      </div>
      <div class="dialog-grid">
        <label class="field wide"><span>{{ t('name') }}</span><input v-model="form.name" required placeholder="dev-server / MES PG"></label>
        <label class="field"><span>{{ t('type') }}</span><select v-model="form.type" @change="changeType"><option value="ssh">SSH Server</option><option value="database">Database</option></select></label>
        <label class="field"><span>{{ t('port') }}</span><input v-model.number="form.port" type="number" min="1" max="65535" required></label>
        <label class="field wide"><span>{{ t('host') }}</span><input v-model="form.host" required placeholder="192.168.1.100 / db.example.com"></label>
        <label class="field"><span>{{ t('username') }}</span><input v-model="form.username" :placeholder="t('optional')"></label>
        <label class="field"><span>{{ t('authType') }}</span><select v-model="form.authType"><option value="privateKey">Private Key</option><option value="password">{{ t('passwordVault') }}</option></select></label>
        <template v-if="form.type === 'database'">
          <label class="field"><span>{{ t('databaseType') }}</span><select v-model="form.databaseType"><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="sqlite">SQLite</option></select></label>
          <label class="field"><span>{{ t('defaultDatabase') }}</span><input v-model="form.database" :placeholder="t('optional')"></label>
        </template>
        <label class="field"><span>{{ t('group') }}</span><select v-model="form.groupId"><option :value="undefined">{{ t('noGroup') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
        <label class="field wide"><span>{{ form.authType === 'privateKey' ? t('privateKey') : t('credential') }}</span><textarea v-if="form.authType === 'privateKey'" v-model="credential" rows="4" autocomplete="off" :placeholder="connection?.credentialId ? t('credentialPlaceholder') : t('privateKeyPlaceholder')"></textarea><input v-else v-model="credential" type="password" autocomplete="new-password" :placeholder="connection?.credentialId ? t('credentialPlaceholder') : t('newCredentialPlaceholder')"></label>
      </div>
      <label class="favorite-check"><input v-model="form.favorite" type="checkbox"><span>{{ t('favorite') }}</span></label>
      <label v-if="connection?.credentialId" class="favorite-check"><input v-model="clearCredential" type="checkbox"><span>{{ t('clearCredential') }}</span></label>
      <p class="dialog-note">{{ t('credentialNote') }}</p>
      <div class="dialog-actions"><button type="button" class="button secondary" @click="emit('close')">{{ t('cancel') }}</button><button type="submit" class="button primary">{{ t('saveConnection') }}</button></div>
    </form>
  </div>
</template>
