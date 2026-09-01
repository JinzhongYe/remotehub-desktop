import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText: string
  danger?: boolean
}

export const confirmState = reactive({ open: false, title: '', message: '', confirmText: '', danger: false })
let pending: Promise<boolean> | null = null
let settle: ((confirmed: boolean) => void) | null = null

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (pending) return pending
  Object.assign(confirmState, options, { open: true, danger: options.danger ?? false })
  pending = new Promise((resolve) => { settle = resolve })
  return pending
}

export function settleConfirm(confirmed: boolean): void {
  if (!pending || !settle) return
  const resolve = settle
  confirmState.open = false
  pending = null
  settle = null
  resolve(confirmed)
}
