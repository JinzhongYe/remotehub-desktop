import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const onBackRequest = vi.hoisted(() => vi.fn())
vi.mock('../src/services', () => ({ appService: { onBackRequest } }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('Android back layers', () => {
  it('closes the latest open layer and releases the native listener when empty', async () => {
    vi.stubEnv('TAURI_ENV_PLATFORM', 'android')
    const stopNative = vi.fn()
    let nativeBack = (): void => undefined
    onBackRequest.mockImplementation((listener: () => void) => {
      nativeBack = listener
      return stopNative
    })
    const { useMobileBackLayer } = await import('../src/renderer/mobile-back')
    const first = ref(false)
    const second = ref(false)
    const closeFirst = vi.fn(() => { first.value = false })
    const closeSecond = vi.fn(() => { second.value = false })
    const scope = effectScope()
    scope.run(() => {
      useMobileBackLayer(() => first.value, closeFirst)
      useMobileBackLayer(() => second.value, closeSecond)
    })

    first.value = true
    second.value = true
    await nextTick()
    nativeBack()
    expect(closeSecond).toHaveBeenCalledOnce()
    expect(closeFirst).not.toHaveBeenCalled()
    await nextTick()
    nativeBack()
    expect(closeFirst).toHaveBeenCalledOnce()
    await nextTick()
    expect(stopNative).toHaveBeenCalledOnce()
    scope.stop()
  })
  it('does not consume back for a layer belonging to an inactive page', async () => {
    vi.stubEnv('TAURI_ENV_PLATFORM', 'android')
    let back = (): void => undefined
    onBackRequest.mockImplementation((listener: () => void) => { back = listener; return vi.fn() })
    const { useMobileBackLayer } = await import('../src/renderer/mobile-back')
    const active = ref(true)
    const open = ref(true)
    const close = vi.fn()
    const scope = effectScope()
    scope.run(() => useMobileBackLayer(() => active.value && open.value, close))
    active.value = false
    await nextTick()
    back()
    expect(close).not.toHaveBeenCalled()
    active.value = true
    await nextTick()
    back()
    expect(close).toHaveBeenCalledOnce()
    scope.stop()
  })

})
