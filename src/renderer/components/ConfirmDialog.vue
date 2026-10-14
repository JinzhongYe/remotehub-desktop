<script setup lang="ts">
import { confirmState, settleConfirm } from '../dialog'
import { t } from '../i18n'
import { useMobileBackLayer } from '../mobile-back'
import { useModalDialog } from '../modal-dialog'

const modal = useModalDialog()

useMobileBackLayer(() => confirmState.open, () => settleConfirm(false))
</script>

<template>
  <Teleport to="body">
    <dialog v-if="confirmState.open" ref="modal" class="modal-layer" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message" @click.self="settleConfirm(false)" @cancel.prevent="settleConfirm(false)">
      <section class="connection-dialog confirm-dialog">
        <div class="confirm-body">
          <span class="confirm-icon" :class="{ danger: confirmState.danger }" aria-hidden="true">{{ confirmState.danger ? '!' : '?' }}</span>
          <div class="confirm-copy"><h2 id="confirm-title">{{ confirmState.title }}</h2><p id="confirm-message">{{ confirmState.message }}</p></div>
        </div>
        <div class="dialog-actions"><button type="button" class="button secondary" autofocus @click="settleConfirm(false)">{{ t('cancel') }}</button><button type="button" class="button" :class="confirmState.danger ? 'danger' : 'primary'" @click="settleConfirm(true)">{{ confirmState.confirmText }}</button></div>
      </section>
    </dialog>
  </Teleport>
</template>
