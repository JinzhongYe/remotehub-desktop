<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SshPasswordOptions } from '../../shared/ssh'
import { t } from '../i18n'
import { useMobileBackLayer } from '../mobile-back'
import { useModalDialog } from '../modal-dialog'

const props = defineProps<{ name: string; protocol: 'ssh' | 'sftp' }>()
const emit = defineEmits<{ submit: [options: SshPasswordOptions]; cancel: []; timeout: [] }>()
const title = computed(() => t(props.protocol === 'sftp' ? 'sftpPasswordPrompt' : 'sshPasswordPrompt'))
const password = ref('')
const savePassword = ref(false)
const modal = useModalDialog()
const remaining = ref(60)
let timer: ReturnType<typeof setInterval> | undefined
let deadline = 0
let finished = false
useMobileBackLayer(() => !finished, () => finish('cancel'))
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
  timer = setInterval(() => {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (!remaining.value) finish('timeout')
  }, 250)
})
onBeforeUnmount(() => { clearInterval(timer); password.value = '' })
</script>

<template>
  <Teleport to="body">
    <dialog ref="modal" class="modal-layer" :aria-label="title" @cancel.prevent="finish('cancel')">
      <form class="connection-dialog ssh-password-dialog" @submit.prevent="finish('submit')">
        <h2>{{ title }}</h2>
        <p>{{ name }}</p>
        <label class="field"><span>{{ t('credential') }}</span><input v-model="password" type="password" required maxlength="16384" autocomplete="current-password" autofocus></label>
        <label class="checkbox"><input v-model="savePassword" type="checkbox"> {{ t('saveSshPassword') }}</label>
        <p role="status">{{ t('sshPasswordCountdown', { seconds: remaining }) }}</p>
        <div class="dialog-actions"><button type="button" class="button secondary" @click="finish('cancel')">{{ t('cancel') }}</button><button class="button primary" type="submit">{{ t('sshAuthenticate') }}</button></div>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ssh-password-dialog { width: min(420px, calc(100vw - 32px)); padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.ssh-password-dialog h2, .ssh-password-dialog p { margin: 0; overflow-wrap: anywhere; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
