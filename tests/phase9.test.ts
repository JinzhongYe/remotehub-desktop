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

  it('switches between single, dual, and quad workspace views', () => {
    setActivePinia(createPinia())
    const workspace = useWorkspaceStore()
    workspace.openConnection('ssh-1', 'Server 1', 'terminal')
    workspace.openConnection('ssh-2', 'Server 2', 'terminal')
    workspace.openConnection('ssh-3', 'Server 3', 'terminal')
    workspace.openConnection('ssh-4', 'Server 4', 'terminal')

    workspace.setViewCount(4)
    expect(workspace.viewCount).toBe(4)
    expect(workspace.visibleIds).toHaveLength(4)
    expect(new Set(workspace.visibleIds).size).toBe(4)

    const secondary = workspace.secondaryIds[0]
    const previousPrimary = workspace.activeId
    workspace.activate(secondary)
    expect(workspace.activeId).toBe(secondary)
    expect(workspace.secondaryIds).toContain(previousPrimary)

    workspace.setViewCount(2)
    expect(workspace.viewCount).toBe(2)
    expect(workspace.visibleIds).toHaveLength(2)
    workspace.setViewCount(1)
    expect(workspace.secondaryIds).toEqual([])
  })
})
