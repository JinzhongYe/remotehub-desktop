import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../src/renderer/stores/workspace'

describe('Phase 9 workspace', () => {
  it('restores valid tabs and preserves pinned tabs through split and bulk close', () => {
    setActivePinia(createPinia())
    const workspace = useWorkspaceStore()
    workspace.restore(['ssh-1'], JSON.stringify({
      tabs: [
        { id: 'connection:ssh-1:7', type: 'terminal', title: 'Server', connectionId: 'ssh-1', pinned: true },
        { id: 'connection:deleted:99', type: 'terminal', title: 'Deleted', connectionId: 'deleted' }
      ],
      activeId: 'connection:ssh-1:7'
    }))

    expect(workspace.tabs).toHaveLength(2)
    workspace.close(workspace.activeId)
    expect(workspace.activeId).toBe('connection:ssh-1:7')

    workspace.openConnection('ssh-1', 'Second', 'terminal')
    expect(workspace.activeId).toBe('connection:ssh-1:8')
    workspace.openSplit()
    expect(workspace.secondaryId).toBe('connection:ssh-1:8')
    expect(workspace.activeId).toBe('connection:ssh-1:7')

    workspace.closeAll()
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(['welcome', 'connection:ssh-1:7'])
    expect(workspace.secondaryId).toBeNull()
  })
})
