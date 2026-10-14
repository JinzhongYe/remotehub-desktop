import { onScopeDispose, watch, type WatchSource } from 'vue'
import { appService } from '../services'

type BackLayer = { close: () => void }

const layers: BackLayer[] = []
let stopListening: (() => void) | undefined

function syncListener(): void {
  if (layers.length && !stopListening) {
    stopListening = appService.onBackRequest(() => layers.at(-1)?.close())
  } else if (!layers.length && stopListening) {
    stopListening()
    stopListening = undefined
  }
}

function addLayer(close: () => void): () => void {
  if (import.meta.env.TAURI_ENV_PLATFORM !== 'android') return () => undefined
  const layer = { close }
  layers.push(layer)
  syncListener()
  return () => {
    const index = layers.lastIndexOf(layer)
    if (index >= 0) layers.splice(index, 1)
    syncListener()
  }
}

export function useMobileBackLayer(open: WatchSource<boolean>, close: () => void): void {
  let remove: (() => void) | undefined
  watch(open, (visible) => {
    remove?.()
    remove = visible ? addLayer(close) : undefined
  }, { immediate: true })
  onScopeDispose(() => remove?.())
}
