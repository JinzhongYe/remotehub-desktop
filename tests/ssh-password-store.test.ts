import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSshPasswordStore } from '../src/renderer/stores/ssh-password'

beforeEach(() => setActivePinia(createPinia()))

describe('shared SSH password prompt', () => {
  it('shares one answer between simultaneous terminal and SFTP requests', async () => {
    const store = useSshPasswordStore()
    const terminal = store.request('server', 'Server · user@host', 'ssh')
    const sftp = store.request('server', 'Server · user@host', 'ssh')
    expect(store.activePrompt).toEqual({ connectionId: 'server', label: 'Server · user@host', protocol: 'ssh' })
    store.submit({ password: 'temporary', savePassword: false })
    await expect(terminal).resolves.toEqual({ status: 'submitted', options: { password: 'temporary', savePassword: false } })
    await expect(sftp).resolves.toEqual({ status: 'submitted', options: { password: 'temporary', savePassword: false } })
    expect(store.activePrompt).toBeNull()
  })

  it('queues prompts for different connections and reports timeout', async () => {
    const store = useSshPasswordStore()
    const first = store.request('first', 'First', 'ssh')
    const second = store.request('second', 'Second', 'sftp')
    expect(store.activePrompt?.connectionId).toBe('first')
    store.cancel()
    await expect(first).resolves.toEqual({ status: 'cancelled' })
    expect(store.activePrompt?.connectionId).toBe('second')
    store.timeout()
    await expect(second).resolves.toEqual({ status: 'timeout' })
  })

  it('does not reuse a submitted password after the current request finishes', async () => {
    const store = useSshPasswordStore()
    const first = store.request('server', 'Server', 'sftp')
    store.submit({ password: 'temporary', savePassword: false })
    await first
    const retry = store.request('server', 'Server', 'sftp')
    expect(store.activePrompt).toEqual({ connectionId: 'server', label: 'Server', protocol: 'sftp' })
    store.cancel()
    await retry
  })
})
