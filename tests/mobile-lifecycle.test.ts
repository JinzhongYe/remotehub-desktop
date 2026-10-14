import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useMobileResume } from '../src/renderer/mobile-lifecycle'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('mobile foreground recovery', () => {
  it('checks only the active visible page and coalesces native and browser resume events', async () => {
    vi.stubEnv('TAURI_ENV_PLATFORM', 'android')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T00:00:00Z'))
    const handlers = new Map<string, () => void>()
    const add = vi.fn((name: string, handle: () => void) => handlers.set(name, handle))
    const remove = vi.fn()
    const document = { visibilityState: 'visible', addEventListener: add, removeEventListener: remove }
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove })
    let active = false
    const resume = vi.fn(async () => undefined)
    const scope = effectScope()
    scope.run(() => useMobileResume(() => active, resume))
    handlers.get('remotehub:resume')!()
    expect(resume).not.toHaveBeenCalled()
    active = true
    document.visibilityState = 'hidden'
    handlers.get('visibilitychange')!()
    expect(resume).not.toHaveBeenCalled()
    document.visibilityState = 'visible'
    handlers.get('remotehub:resume')!()
    handlers.get('visibilitychange')!()
    await Promise.resolve()
    expect(resume).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1001)
    handlers.get('online')!()
    await Promise.resolve()
    expect(resume).toHaveBeenCalledTimes(2)
    scope.stop()
    expect(remove).toHaveBeenCalledTimes(3)
  })
})
