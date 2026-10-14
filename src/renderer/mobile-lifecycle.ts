import { onScopeDispose } from 'vue'

export function useMobileResume(enabled: () => boolean, resume: () => Promise<void>): void {
  if (!['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM)) return
  let busy = false
  let lastResume = 0
  const handle = (): void => {
    if (document.visibilityState === 'hidden' || !enabled() || busy || Date.now() - lastResume < 1000) return
    lastResume = Date.now()
    busy = true
    void resume().finally(() => { busy = false })
  }
  document.addEventListener('visibilitychange', handle)
  window.addEventListener('remotehub:resume', handle)
  window.addEventListener('online', handle)
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', handle)
    window.removeEventListener('remotehub:resume', handle)
    window.removeEventListener('online', handle)
  })
}
