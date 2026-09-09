import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSshPasswordStore } from '../src/renderer/stores/ssh-password'

beforeEach(() => setActivePinia(createPinia()))

describe('shared SSH password prompt', () => {
  it('shares one answer between simultaneous terminal and SFTP requests', async () => {
    const store = useSshPasswordStore()
    const terminal = store.request('server', 'Server · user@host')
    const sftp = store.request('server', 'Server · user@host')
    expect(store.activePrompt).toEqual({ connectionId: 'server', label: 'Server · user@host' })
    store.submit({ password: 'temporary', savePassword: false })
    await expect(terminal).resolves.toEqual({ status: 'submitted', options: { password: 'temporary', savePassword: false } })
    await expect(sftp).resolves.toEqual({ status: 'submitted', options: { password: 'temporary', savePassword: false } })
    expect(store.activePrompt).toBeNull()
  })

  it('queues prompts for different connections and reports timeout', async () => {
    const store = useSshPasswordStore()
    const first = store.request('first', 'First')
    const second = store.request('second', 'Second')
    expect(store.activePrompt?.connectionId).toBe('first')
    store.cancel()
    await expect(first).resolves.toEqual({ status: 'cancelled' })
    expect(store.activePrompt?.connectionId).toBe('second')
    store.timeout()
    await expect(second).resolves.toEqual({ status: 'timeout' })
  })

  it('forgets a rejected cached password so reconnect asks again', async () => {
    const store = useSshPasswordStore()
    const first = store.request('server', 'Server')
    store.submit({ password: 'wrong', savePassword: false })
    await first
    store.forget('server')
    const retry = store.request('server', 'Server')
    expect(store.activePrompt?.connectionId).toBe('server')
    store.cancel()
    await retry
  })
})
