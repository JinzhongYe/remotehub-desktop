import { shallowRef, watch } from 'vue'

// Let the browser keep background controls inert; restore focus even after Vue removes the dialog.
export function useModalDialog() {
  const dialog = shallowRef<HTMLDialogElement | null>(null)
  watch(dialog, (element, _previous, onCleanup) => {
    if (!element) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    onCleanup(() => {
      element.close()
      if (opener?.isConnected) opener.focus()
    })
  }, { flush: 'post' })
  return dialog
}
