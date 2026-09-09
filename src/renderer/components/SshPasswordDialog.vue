<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SshPasswordOptions } from '../../shared/ssh'
import { t } from '../i18n'

const props = defineProps<{ name: string; protocol: 'ssh' | 'sftp' }>()
const emit = defineEmits<{ submit: [options: SshPasswordOptions]; cancel: []; timeout: [] }>()
const title = computed(() => t(props.protocol === 'sftp' ? 'sftpPasswordPrompt' : 'sshPasswordPrompt'))
const password = ref('')
const savePassword = ref(false)
const input = ref<HTMLInputElement | null>(null)
const remaining = ref(60)
let timer: ReturnType<typeof setInterval> | undefined
let deadline = 0
let finished = false
function finish(kind: 'submit' | 'cancel' | 'timeout'): void {
  if (finished) return
  if (kind === 'submit' && Date.now() >= deadline) kind = 'timeout'
  if (kind === 'submit' && !password.value) return
  finished = true
  clearInterval(timer)
  if (kind === 'submit') emit('submit', { password: password.value, savePassword: savePassword.value })
  else if (kind === 'cancel') emit('cancel')
  else emit('timeout')
  password.value = ''
}
onMounted(() => {
  deadline = Date.now() + 60000
  input.value?.focus()
  timer = setInterval(() => {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (!remaining.value) finish('timeout')
  }, 250)
})
onBeforeUnmount(() => { clearInterval(timer); password.value = '' })
</script>

<template>
  <Teleport to="body">
    <div class="modal-layer" @keydown.esc.stop.prevent="finish('cancel')">
      <form class="connection-dialog ssh-password-dialog" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="finish('submit')">
        <h2>{{ title }}</h2>
        <p>{{ name }}</p>
        <label class="field"><span>{{ t('credential') }}</span><input ref="input" v-model="password" type="password" required maxlength="16384" autocomplete="current-password"></label>
        <label class="checkbox"><input v-model="savePassword" type="checkbox"> {{ t('saveSshPassword') }}</label>
        <p role="status">{{ t('sshPasswordCountdown', { seconds: remaining }) }}</p>
        <div class="dialog-actions"><button type="button" class="button secondary" @click="finish('cancel')">{{ t('cancel') }}</button><button class="button primary" type="submit">{{ t('sshAuthenticate') }}</button></div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.ssh-password-dialog { width: min(420px, calc(100vw - 32px)); padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.ssh-password-dialog h2, .ssh-password-dialog p { margin: 0; overflow-wrap: anywhere; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
