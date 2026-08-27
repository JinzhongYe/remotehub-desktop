import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { fingerprintHostKey, hostKeyState } from '../src/main/services/host-key'
import { useWorkspaceStore } from '../src/renderer/stores/workspace'

describe('Phase 3 workspace sessions', () => {
  it('opens independent tabs for the same SSH or database connection', () => {
    setActivePinia(createPinia())
    const workspace = useWorkspaceStore()

    workspace.openConnection('ssh-1', 'Server', 'terminal')
    workspace.openConnection('ssh-1', 'Server', 'terminal')
    workspace.openConnection('db-1', 'Database', 'sql')

    expect(workspace.tabs.map((tab) => tab.id)).toHaveLength(new Set(workspace.tabs.map((tab) => tab.id)).size)
    expect(workspace.tabs.filter((tab) => tab.connectionId === 'ssh-1')).toHaveLength(2)
    expect(workspace.tabs.at(-1)?.type).toBe('sql')
  })

  it('pins the first host key and blocks later changes', () => {
    const fingerprint = fingerprintHostKey(Buffer.from('host-key'))

    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    expect(hostKeyState(undefined, fingerprint)).toBe('new')
    expect(hostKeyState(fingerprint, fingerprint)).toBe('trusted')
    expect(hostKeyState(fingerprint, fingerprintHostKey(Buffer.from('changed')))).toBe('changed')
  })
})
