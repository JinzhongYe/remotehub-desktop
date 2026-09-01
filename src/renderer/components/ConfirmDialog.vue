<script setup lang="ts">
import { confirmState, settleConfirm } from '../dialog'
import { t } from '../i18n'
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="modal-layer" @click.self="settleConfirm(false)" @keydown.esc.stop="settleConfirm(false)">
      <section class="connection-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div class="confirm-body">
          <span class="confirm-icon" :class="{ danger: confirmState.danger }" aria-hidden="true">{{ confirmState.danger ? '!' : '?' }}</span>
          <div class="confirm-copy"><h2 id="confirm-title">{{ confirmState.title }}</h2><p id="confirm-message">{{ confirmState.message }}</p></div>
        </div>
        <div class="dialog-actions"><button type="button" class="button secondary" autofocus @click="settleConfirm(false)">{{ t('cancel') }}</button><button type="button" class="button" :class="confirmState.danger ? 'danger' : 'primary'" @click="settleConfirm(true)">{{ confirmState.confirmText }}</button></div>
      </section>
    </div>
  </Teleport>
</template>
