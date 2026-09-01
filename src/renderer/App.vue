<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { confirmDialog } from './dialog'
import { t } from './i18n'

let removeCloseListener: (() => void) | undefined
let closePromptOpen = false

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

<template><RouterView /><ConfirmDialog /></template>
