<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import SshPasswordDialog from './components/SshPasswordDialog.vue'
import { confirmDialog } from './dialog'
import { t } from './i18n'
import { useSshPasswordStore } from './stores/ssh-password'

let removeCloseListener: (() => void) | undefined
let closePromptOpen = false
const sshPassword = useSshPasswordStore()

onMounted(() => {
  removeCloseListener = window.api.app.onCloseRequest(async () => {
    if (closePromptOpen) return
    closePromptOpen = true
    try {
      if (await confirmDialog({ title: t('closeAppTitle'), message: t('closeAppMessage'), confirmText: t('exitApp'), danger: true })) await window.api.app.confirmClose()
    } finally { closePromptOpen = false }
  })
})

onUnmounted(() => removeCloseListener?.())
</script>

<template>
  <RouterView />
  <ConfirmDialog />
  <SshPasswordDialog
    v-if="sshPassword.activePrompt"
    :key="sshPassword.activePrompt.connectionId"
    :name="sshPassword.activePrompt.label"
    :protocol="sshPassword.activePrompt.protocol"
    @submit="sshPassword.submit"
    @cancel="sshPassword.cancel"
    @timeout="sshPassword.timeout"
  />
</template>
