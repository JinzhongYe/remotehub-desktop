import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useWorkspaceStore } from '../src/renderer/stores/workspace'

let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

describe('independent per-tab SFTP layout', () => {
  it('toggles just one view even when two tabs use the same SSH connection', () => {
    const workspace = useWorkspaceStore()
    workspace.openConnection('same-server', 'Server', 'terminal')
    const first = workspace.activeId
    workspace.openConnection('same-server', 'Server', 'terminal')
    const second = workspace.activeId
    workspace.setViewCount(2)
    workspace.toggleSftp(first)
    expect(workspace.tabs.find(tab => tab.id === first)?.sftpOpen).toBe(false)
    expect(workspace.tabs.find(tab => tab.id === second)?.sftpOpen).toBe(true)
    workspace.activate(first)
    workspace.toggleSftp(second)
    expect(workspace.tabs.filter(tab => tab.closable).map(tab => tab.sftpOpen)).toEqual([false, false])
    workspace.toggleSftp(first)
    expect(workspace.tabs.filter(tab => tab.closable).map(tab => tab.sftpOpen)).toEqual([true, false])
    workspace.$dispose()
  })

  it('keeps each dock position independent across four views and view switches', () => {
    const workspace = useWorkspaceStore()
    for (let i = 0; i < 4; i++) workspace.openConnection(`server-${i}`, `Server ${i}`, 'terminal')
    const tabs = workspace.tabs.filter(tab => tab.closable)
    workspace.setViewCount(4)
    workspace.setSftpPosition(tabs[0].id, 'left')
    workspace.setSftpPosition(tabs[1].id, 'top')
    workspace.setViewCount(1)
    workspace.setViewCount(4)
    expect(tabs.map(tab => tab.sftpPosition)).toEqual(['left', 'top', 'bottom', 'bottom'])
    workspace.$dispose()
  })

  it('persists and restores each tab without reverting to a shared setting', async () => {
    const workspace = useWorkspaceStore()
    workspace.openConnection('server', 'First', 'terminal')
    const first = workspace.activeId
    workspace.openConnection('server', 'Second', 'terminal')
    workspace.toggleSftp(first)
    workspace.setSftpPosition(first, 'right')
    workspace.setSftpPosition(workspace.activeId, 'top')
    await nextTick()
    const serialized = storage.get('remotehub.workspace')
    workspace.restore(['server'], serialized)
    expect(workspace.tabs.filter(tab => tab.closable).map(tab => [tab.sftpOpen, tab.sftpPosition])).toEqual([[false, 'right'], [true, 'top']])
    expect(storage.has('remotehub.sftpOpen')).toBe(false)
    expect(storage.has('remotehub.sftpPosition')).toBe(false)
    workspace.$dispose()
  })

  it('migrates legacy defaults once per tab and validates restored preferences', () => {
    storage.set('remotehub.sftpOpen', 'false')
    storage.set('remotehub.sftpPosition', 'left')
    const workspace = useWorkspaceStore()
    workspace.restore(['server'], JSON.stringify({ tabs: [
      { id: 'server:1', title: 'Legacy', type: 'terminal', connectionId: 'server' },
      { id: 'server:2', title: 'Invalid', type: 'terminal', connectionId: 'server', sftpOpen: 'true', sftpPosition: 'sideways' }
    ] }))
    expect(workspace.tabs[1]).toMatchObject({ sftpOpen: false, sftpPosition: 'left' })
    expect(workspace.tabs[2]).toMatchObject({ sftpOpen: false, sftpPosition: 'bottom' })
    workspace.toggleSftp('server:1')
    expect(workspace.tabs[2].sftpOpen).toBe(false)
    expect(storage.get('remotehub.sftpOpen')).toBe('false')
    workspace.$dispose()
  })

  it('drops closed-tab preferences and does not attach SFTP state to other tab types', () => {
    const workspace = useWorkspaceStore()
    workspace.openConnection('server', 'Old', 'terminal')
    const old = workspace.activeId
    workspace.toggleSftp(old)
    workspace.setSftpPosition(old, 'top')
    workspace.close(old)
    workspace.openConnection('server', 'New', 'terminal')
    expect(workspace.activeTab).toMatchObject({ sftpOpen: true, sftpPosition: 'bottom' })
    workspace.openConnection('db', 'Database', 'sql')
    workspace.toggleSftp(workspace.activeId)
    workspace.setSftpPosition(workspace.activeId, 'left')
    workspace.toggleSftp('welcome')
    expect(workspace.activeTab.sftpOpen).toBeUndefined()
    expect(workspace.tabs[0].sftpOpen).toBeUndefined()
    workspace.$dispose()
  })
})
