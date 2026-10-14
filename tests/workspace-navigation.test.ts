import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/renderer/stores/workspace'
import { tabDragScroll, tabWheelDelta } from '../src/renderer/tab-navigation'

let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

function setup(count = 6) {
  const workspace = useWorkspaceStore()
  for (let index = 0; index < count; index++) workspace.openConnection('server', `Session ${index}`, 'terminal')
  return { workspace, ids: workspace.tabs.slice(1).map(tab => tab.id) }
}

describe('independent workspace pane navigation', () => {
  it('restores a valid connection when the saved active tab has disappeared', () => {
    const { workspace, ids } = setup(2)
    const serialized = JSON.stringify({ tabs: workspace.tabs.slice(1), activeId: 'deleted-tab', paneIds: ['welcome'], viewCount: 1 })
    workspace.restore(['server'], serialized)
    expect(workspace.activeId).toBe(ids[0])
    expect(workspace.visibleIds).toEqual([ids[0]])
    expect(workspace.connectionTabs.map(tab => tab.id)).toEqual(ids)
    workspace.$dispose()
  })

  it('cycles only through displayed connection tabs, including when starting at home', () => {
    const { workspace, ids } = setup(2)
    expect(workspace.connectionTabs.map(tab => tab.id)).toEqual(ids)
    workspace.activate('welcome')
    workspace.cycle(1)
    expect(workspace.activeId).toBe(ids[0])
    workspace.cycle(-1)
    expect(workspace.activeId).toBe(ids[1])
    workspace.cycle(1)
    expect(workspace.activeId).toBe(ids[0])
    workspace.activate('welcome')
    workspace.cycle(-1)
    expect(workspace.activeId).toBe(ids[1])
    expect(workspace.tabs[0].id).toBe('welcome')
    workspace.$dispose()
  })

  it('keeps home available after closing the final displayed tab', async () => {
    const { workspace, ids } = setup(1)
    await workspace.close(ids[0])
    expect(workspace.connectionTabs).toEqual([])
    workspace.cycle(1)
    workspace.cycle(-1)
    expect(workspace.activeId).toBe('welcome')
    expect(workspace.tabs.map(tab => tab.id)).toEqual(['welcome'])
    await nextTick()
    workspace.$dispose()
    setActivePinia(createPinia())
    const restored = useWorkspaceStore()
    restored.restore(['server'])
    expect(restored.activeId).toBe('welcome')
    expect(restored.connectionTabs).toEqual([])
    restored.$dispose()
  })

  it('preserves every tab when a bulk close is cancelled and guards forced asset deletion', async () => {
    const { workspace, ids } = setup(2)
    const before = workspace.tabs.map((tab) => tab.id)
    const guard = vi.fn(async () => false)
    const unregister = workspace.registerCloseGuard(ids[1], guard)
    await expect(workspace.closeAll()).resolves.toBe(false)
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(before)
    workspace.togglePinned(ids[1])
    await expect(workspace.removeConnection('server')).resolves.toBe(false)
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(before)
    unregister()
    await expect(workspace.removeConnection('server')).resolves.toBe(true)
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(['welcome'])
    workspace.$dispose()
  })

  it('guards individual closes, right-side closes, app exit and embedded SFTP dismissal', async () => {
    const { workspace, ids } = setup(2)
    const guard = vi.fn(async () => false)
    const unregister = workspace.registerCloseGuard(ids[1], guard)
    await expect(workspace.close(ids[1])).resolves.toBe(false)
    await expect(workspace.closeRight(ids[0])).resolves.toBe(false)
    await expect(workspace.canClose()).resolves.toBe(false)
    await workspace.toggleSftp(ids[1])
    expect(workspace.tabs.find((tab) => tab.id === ids[1])?.sftpOpen).toBe(true)
    guard.mockResolvedValue(true)
    await workspace.toggleSftp(ids[1])
    expect(workspace.tabs.find((tab) => tab.id === ids[1])?.sftpOpen).toBe(false)
    await expect(workspace.close(ids[1])).resolves.toBe(true)
    unregister()
    workspace.$dispose()
  })

  it('replaces the focused right pane without changing the left pane', () => {
    const { workspace, ids } = setup()
    workspace.setViewCount(2)
    const [left, right] = workspace.visibleIds
    workspace.focusPane(right)
    workspace.activate(ids[0])
    expect(workspace.visibleIds).toEqual([left, ids[0]])
    expect(workspace.activeId).toBe(ids[0])
    workspace.activate(left)
    expect(workspace.visibleIds).toEqual([left, ids[0]])
    expect(workspace.activeId).toBe(left)
    workspace.$dispose()
  })

  it('independently replaces all four fixed positions', () => {
    const { workspace, ids } = setup(8)
    workspace.setViewCount(4)
    for (let index = 0; index < 4; index++) {
      const expected = [...workspace.visibleIds]
      workspace.focusPane(expected[index])
      workspace.activate(ids[index])
      expected[index] = ids[index]
      expect(workspace.visibleIds).toEqual(expected)
      expect(workspace.paneIndex(ids[index])).toBe(index)
    }
    workspace.$dispose()
  })

  it('opens a new connection in the focused pane', () => {
    const { workspace } = setup()
    workspace.setViewCount(2)
    const [left, right] = workspace.visibleIds
    workspace.focusPane(right)
    workspace.openConnection('new-server', 'New session', 'terminal')
    expect(workspace.visibleIds).toEqual([left, workspace.activeId])
    expect(workspace.activeTab.connectionId).toBe('new-server')
    workspace.$dispose()
  })

  it('swaps already visible tabs only when explicitly chosen for another pane', () => {
    const { workspace } = setup()
    workspace.setViewCount(2)
    const [left, right] = workspace.visibleIds
    workspace.showInPane(right, left)
    expect(workspace.visibleIds).toEqual([right, left])
    expect(workspace.activeId).toBe(left)
    workspace.showInPane('missing', right)
    workspace.showInPane(left, 'missing')
    expect(workspace.visibleIds).toEqual([right, left])
    workspace.$dispose()
  })

  it('keeps other panes stable when closing a visible tab and reuses a hidden tab', () => {
    const { workspace } = setup()
    workspace.setViewCount(2)
    const [left, right] = workspace.visibleIds
    workspace.focusPane(right)
    workspace.close(right)
    expect(workspace.visibleIds[0]).toBe(left)
    expect(workspace.visibleIds).toHaveLength(2)
    expect(workspace.visibleIds).not.toContain(right)
    expect(workspace.activeId).toBe(workspace.visibleIds[1])
    const tabCount = workspace.tabs.length
    workspace.closePane(workspace.activeId)
    expect(workspace.visibleIds).toEqual([left])
    expect(workspace.tabs).toHaveLength(tabCount)
    workspace.closeAll()
    expect(workspace.visibleIds).toEqual(['welcome'])
    workspace.$dispose()
  })

  it('retains the focused connection when reducing the number of views', () => {
    const { workspace } = setup()
    workspace.setViewCount(4)
    const focused = workspace.visibleIds[3]
    workspace.focusPane(focused)
    workspace.setViewCount(2)
    expect(workspace.visibleIds).toContain(focused)
    expect(workspace.activeId).toBe(focused)
    workspace.setViewCount(1)
    expect(workspace.visibleIds).toEqual([focused])
    workspace.$dispose()
  })

  it('persists physical pane positions, focus, tab order, and SFTP preferences separately', async () => {
    const { workspace, ids } = setup()
    workspace.setViewCount(4)
    workspace.focusPane(workspace.visibleIds[2])
    workspace.toggleSftp(workspace.activeId)
    const active = workspace.activeId
    const panes = [...workspace.visibleIds]
    workspace.moveTab(ids[5], ids[0])
    const order = workspace.tabs.map(tab => tab.id)
    await nextTick()
    workspace.restore(['server'], storage.get('remotehub.workspace'))
    expect(workspace.visibleIds).toEqual(panes)
    expect(workspace.activeId).toBe(active)
    expect(workspace.tabs.map(tab => tab.id)).toEqual(order)
    expect(workspace.activeTab.sftpOpen).toBe(false)
    workspace.$dispose()
  })

  it('migrates legacy split state and rejects duplicate or missing saved panes', () => {
    const { workspace, ids } = setup()
    const tabs = workspace.tabs.slice(1)
    workspace.restore(['server'], JSON.stringify({ tabs, activeId: ids[0], secondaryIds: ids.slice(1, 4), viewCount: 4 }))
    expect(workspace.visibleIds).toEqual(ids.slice(0, 4))
    workspace.restore(['server'], JSON.stringify({ tabs, activeId: ids[1], paneIds: [ids[0], ids[0], 'missing', ids[1]], viewCount: 4 }))
    expect(workspace.visibleIds).toEqual(ids.slice(0, 2))
    expect(workspace.activeId).toBe(ids[1])
    workspace.$dispose()
  })

  it('restores a connection instead of the removed Welcome tab and cycles only connections', () => {
    const { workspace, ids } = setup()
    workspace.restore(['server'], JSON.stringify({ tabs: workspace.tabs.slice(1), activeId: 'welcome', paneIds: ['welcome'] }))
    expect(workspace.activeId).toBe(ids[0])
    expect(workspace.visibleIds).toEqual([ids[0]])
    workspace.cycle(1)
    expect(workspace.activeId).toBe(ids[1])
    workspace.cycle(-1)
    expect(workspace.activeId).toBe(ids[0])
    workspace.$dispose()
  })

  it('reorders existing tab objects without moving panes, changing focus, or moving Welcome', () => {
    const { workspace, ids } = setup()
    workspace.setViewCount(4)
    const panes = [...workspace.visibleIds]
    const active = workspace.activeId
    const tab = workspace.tabs.find(item => item.id === ids[5])
    workspace.moveTab(ids[5], ids[0])
    expect(workspace.tabs[1]).toBe(tab)
    workspace.moveTab(ids[5], ids[4], true)
    expect(workspace.tabs.at(-1)).toBe(tab)
    workspace.moveTab(ids[5], 'welcome')
    expect(workspace.tabs[0].id).toBe('welcome')
    expect(workspace.tabs[1]).toBe(tab)
    workspace.moveTab('welcome', ids[0])
    workspace.moveTab(ids[0], 'missing')
    expect(workspace.tabs[0].id).toBe('welcome')
    expect(workspace.visibleIds).toEqual(panes)
    expect(workspace.activeId).toBe(active)
    workspace.$dispose()
  })
})

describe('tab strip pointer navigation', () => {
  it('maps wheel and trackpad gestures to horizontal pixels without intercepting zoom', () => {
    const event = { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false }
    expect(tabWheelDelta(event, 500)).toBe(100)
    expect(tabWheelDelta({ ...event, deltaY: -3, deltaMode: 1 }, 500)).toBe(-120)
    expect(tabWheelDelta({ ...event, deltaY: 1, deltaMode: 2 }, 500)).toBe(500)
    expect(tabWheelDelta({ ...event, deltaX: -120 }, 500)).toBe(-120)
    expect(tabWheelDelta({ ...event, ctrlKey: true }, 500)).toBe(0)
    expect(tabWheelDelta({ ...event, deltaY: Infinity }, 500)).toBe(0)
  })

  it('scrolls during a drag near the strip edges, but not outside the strip', () => {
    expect(tabDragScroll(105, 100, 800)).toBe(-12)
    expect(tabDragScroll(795, 100, 800)).toBe(12)
    expect(tabDragScroll(450, 100, 800)).toBe(0)
    expect(tabDragScroll(90, 100, 800)).toBe(0)
    expect(tabDragScroll(810, 100, 800)).toBe(0)
  })
})
