<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Connection, ConnectionInput, Group } from '../../shared/types'
import type { SerialPortInfo } from '../../shared/serial'
import { localShellName } from '../../shared/local-shell'
import { privateKeyFileName } from '../../shared/private-key'
import { t } from '../i18n'

const props = defineProps<{ open: boolean; connection?: Connection | null; groups: Group[]; connections: Connection[]; platform?: string }>()
const emit = defineEmits<{ close: []; save: [value: ConnectionInput, credential?: string, clearCredential?: boolean, privateKeyPath?: string] }>()
const shellTypeName = computed(() => localShellName(props.platform || ''))

const form = reactive<ConnectionInput>({ name: '', type: 'ssh', host: '', port: 22, username: '', authType: 'privateKey', databaseType: 'mysql', database: '', databaseSslMode: 'disable', favorite: false })
const credential = ref('')
const clearCredential = ref(false)
const privateKeyPath = ref('')
const serialPorts = ref<SerialPortInfo[]>([])
const serialPortsError = ref('')
const connectionForm = ref<HTMLFormElement>()
const testing = ref(false)
const testMessage = ref('')
const testSucceeded = ref(false)

watch(() => [props.open, props.connection], () => {
  const item = props.connection
  form.id = item?.id
  form.name = item?.name || ''
  form.type = item?.type || 'ssh'
  form.host = item?.host || ''
  form.port = item?.port || (form.type === 'database' ? 3306 : form.type === 'serial' ? 115200 : form.type === 'shell' ? 1 : 22)
  form.username = item?.username || ''
  form.authType = form.type === 'shell' || form.type === 'serial' ? undefined : form.type === 'database' ? 'password' : item?.authType || 'privateKey'
  form.databaseType = item?.databaseType || 'mysql'
  form.database = item?.database || ''
  form.databaseSslMode = item?.databaseSslMode || 'disable'
  form.sshTunnelId = item?.sshTunnelId
  form.credentialId = item?.credentialId
  form.groupId = item?.groupId
  form.favorite = item?.favorite || false
  form.sortOrder = item?.sortOrder
  credential.value = ''
  clearCredential.value = false
  privateKeyPath.value = ''
  testMessage.value = ''
  testSucceeded.value = false
  if (props.open && form.type === 'serial') void loadSerialPorts()
}, { immediate: true })

function submit(): void {
  emit('save', connectionInput(), credential.value || undefined, clearCredential.value, form.type === 'ssh' ? privateKeyPath.value || undefined : undefined)
}

function connectionInput(): ConnectionInput {
  return { ...form, name: form.name.trim(), host: form.host.trim(), username: form.username?.trim(), authType: form.type === 'shell' || form.type === 'serial' || (form.type === 'database' && form.databaseType === 'sqlite') ? undefined : form.type === 'database' ? 'password' : form.authType }
}

async function testConnection(): Promise<void> {
  if (!connectionForm.value?.reportValidity()) return
  testing.value = true
  testMessage.value = ''
  try {
    const result = await window.api.connections.test({ connection: connectionInput(), credential: credential.value || undefined })
    testSucceeded.value = result.ok
    testMessage.value = result.ok ? t('testOk', { latency: result.latencyMs }) : t('testFailed', { code: result.code })
  } catch (error) {
    testSucceeded.value = false
    testMessage.value = error instanceof Error ? error.message : t('testFailed', { code: 'CONNECTION_FAILED' })
  } finally {
    testing.value = false
  }
}

function changeType(): void {
  if (form.type === 'database') {
    if (form.port === 1 || form.port === 22 || form.port === 115200 || form.port > 65535) form.port = form.databaseType === 'mysql' ? 3306 : form.databaseType === 'postgres' ? 5432 : 1
    form.authType = form.databaseType === 'sqlite' ? undefined : 'password'
  }
  if (form.type === 'ssh' && (form.port === 1 || form.port === 5432 || form.port === 115200 || form.port > 65535)) form.port = 22
  if (form.type === 'serial') {
    form.port = 115200
    form.authType = undefined
    void loadSerialPorts()
  } else if (form.type === 'shell') {
    form.port = 1
    form.authType = undefined
  } else if (!form.authType) {
    form.authType = 'privateKey'
  }
}

function changeDatabaseType(): void {
  form.port = form.databaseType === 'mysql' ? 3306 : form.databaseType === 'postgres' ? 5432 : 1
  form.authType = form.databaseType === 'sqlite' ? undefined : 'password'
}

async function loadSerialPorts(): Promise<void> {
  serialPortsError.value = ''
  try {
    serialPorts.value = await window.api.serial.listPorts()
  } catch (error) {
    serialPortsError.value = error instanceof Error ? error.message : t('serialListFailed')
  }
}

async function choosePrivateKey(): Promise<void> {
  const path = await window.api.app.choosePrivateKey()
  if (path) {
    privateKeyPath.value = path
    credential.value = ''
    clearCredential.value = false
  }
}

async function chooseDatabaseFile(): Promise<void> {
  const path = await window.api.app.chooseDatabaseFile()
  if (path) form.host = path
}

async function chooseShellDirectory(): Promise<void> {
  const path = await window.api.app.chooseShellDirectory()
  if (path) form.host = path
}
</script>

<template>
  <div v-if="open" class="modal-layer" @click.self="emit('close')">
    <form ref="connectionForm" class="connection-dialog" @submit.prevent="submit">
      <div class="dialog-heading">
        <div><span class="eyebrow">{{ t('connectionAsset') }}</span><h2>{{ connection ? t('editConnection') : t('newConnection') }}</h2></div>
        <button type="button" class="icon-button" :aria-label="t('cancel')" @click="emit('close')">×</button>
      </div>
      <div class="dialog-grid">
        <label class="field wide"><span>{{ t('name') }}</span><input v-model="form.name" required placeholder="dev-server / MES PG"></label>
        <label class="field"><span>{{ t('type') }}</span><select v-model="form.type" @change="changeType"><option value="ssh">SSH Server</option><option value="database">Database</option><option value="serial">Serial / 串口</option><option value="shell">{{ shellTypeName }}</option></select></label>
        <label v-if="form.type !== 'shell' && (form.databaseType !== 'sqlite' || form.type !== 'database')" class="field"><span>{{ form.type === 'serial' ? t('baudRate') : t('port') }}</span><input v-model.number="form.port" type="number" min="1" :max="form.type === 'serial' ? 4000000 : 65535" required></label>
        <label class="field wide"><span>{{ form.type === 'shell' ? t('workingDirectory') : form.type === 'serial' ? t('serialPath') : form.type === 'database' && form.databaseType === 'sqlite' ? t('databaseFile') : t('host') }}</span><span v-if="form.type === 'shell'" class="input-with-action"><input v-model="form.host" required placeholder="C:\Projects / /home/user/Projects"><button type="button" class="button secondary" @click="chooseShellDirectory">{{ t('chooseFolder') }}</button></span><span v-else-if="form.type === 'serial'" class="input-with-action"><input v-model="form.host" required list="serial-port-list" placeholder="COM3 / /dev/ttyUSB0"><button type="button" class="button secondary" @click="loadSerialPorts">{{ t('refresh') }}</button></span><span v-else-if="form.type === 'database' && form.databaseType === 'sqlite'" class="input-with-action"><input v-model="form.host" required placeholder="/data/app.db"><button type="button" class="button secondary" @click="chooseDatabaseFile">{{ t('chooseFile') }}</button></span><input v-else v-model="form.host" required placeholder="192.168.1.100 / db.example.com"><datalist id="serial-port-list"><option v-for="item in serialPorts" :key="item.path" :value="item.path">{{ item.manufacturer }}</option></datalist><small v-if="form.type === 'serial' && serialPortsError" class="field-error">{{ serialPortsError }}</small></label>
        <template v-if="form.type !== 'serial' && form.type !== 'shell'">
          <label v-if="form.type !== 'database' || form.databaseType !== 'sqlite'" class="field"><span>{{ t('username') }}</span><input v-model="form.username" :required="form.type === 'database'" :placeholder="form.type === 'database' ? 'root / app_user' : t('optional')"></label>
          <label v-if="form.type === 'ssh'" class="field"><span>{{ t('authType') }}</span><select v-model="form.authType"><option value="privateKey">Private Key</option><option value="password">{{ t('passwordVault') }}</option></select></label>
        </template>
        <template v-if="form.type === 'database'">
          <label class="field"><span>{{ t('databaseType') }}</span><select v-model="form.databaseType" @change="changeDatabaseType"><option value="mysql">MySQL · Phase 6</option><option value="postgres">PostgreSQL · Phase 7</option><option value="sqlite">SQLite · Phase 8</option></select></label>
          <label v-if="form.databaseType !== 'sqlite'" class="field"><span>{{ t('defaultDatabase') }}</span><input v-model="form.database" :placeholder="t('optional')"></label>
          <label v-if="form.databaseType === 'postgres'" class="field"><span>{{ t('sslMode') }}</span><select v-model="form.databaseSslMode"><option value="disable">{{ t('sslDisable') }}</option><option value="require">{{ t('sslRequire') }}</option><option value="verify-full">{{ t('sslVerify') }}</option></select></label>
          <label v-if="form.databaseType === 'postgres'" class="field"><span>{{ t('sshTunnel') }}</span><select v-model="form.sshTunnelId"><option :value="undefined">{{ t('noTunnel') }}</option><option v-for="item in connections.filter((candidate) => candidate.type === 'ssh')" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        </template>
        <label class="field"><span>{{ t('group') }}</span><select v-model="form.groupId"><option :value="undefined">{{ t('noGroup') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
        <label v-if="form.type !== 'serial' && form.type !== 'shell' && (form.type !== 'database' || form.databaseType !== 'sqlite')" class="field wide"><span>{{ form.authType === 'privateKey' ? t('privateKey') : t('credential') }}</span><template v-if="form.authType === 'privateKey'"><span class="private-key-picker"><button type="button" class="button secondary" @click="choosePrivateKey">{{ t('choosePrivateKey') }}</button><small :title="privateKeyPath">{{ privateKeyPath ? privateKeyFileName(privateKeyPath) : t('noFileSelected') }}</small></span><textarea v-model="credential" rows="4" autocomplete="off" :disabled="Boolean(privateKeyPath)" :placeholder="connection?.credentialId ? t('credentialPlaceholder') : t('privateKeyPlaceholder')"></textarea><button v-if="privateKeyPath" type="button" class="text-button align-start" @click="privateKeyPath = ''">{{ t('pasteInstead') }}</button></template><input v-else v-model="credential" type="password" autocomplete="new-password" :placeholder="connection?.credentialId ? t('credentialPlaceholder') : t('newCredentialPlaceholder')"></label>
      </div>
      <label class="favorite-check"><input v-model="form.favorite" type="checkbox"><span>{{ t('favorite') }}</span></label>
      <label v-if="connection?.credentialId && form.type !== 'serial' && form.type !== 'shell' && (form.type !== 'database' || form.databaseType !== 'sqlite')" class="favorite-check"><input v-model="clearCredential" type="checkbox"><span>{{ t('clearCredential') }}</span></label>
      <p v-if="form.type !== 'serial' && form.type !== 'shell' && (form.type !== 'database' || form.databaseType !== 'sqlite')" class="dialog-note">{{ t('credentialNote') }}</p>
      <p v-if="testMessage" class="connection-test-result" :class="{ success: testSucceeded }" role="status">{{ testMessage }}</p>
      <div class="dialog-actions"><button type="button" class="button secondary" @click="emit('close')">{{ t('cancel') }}</button><button v-if="!connection" type="button" class="button secondary" :disabled="testing" @click="testConnection">{{ testing ? t('connecting') : t('test') }}</button><button type="submit" class="button primary">{{ t('saveConnection') }}</button></div>
    </form>
  </div>
</template>
