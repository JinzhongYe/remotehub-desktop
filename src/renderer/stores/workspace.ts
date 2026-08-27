import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

export type WorkspaceTabType = 'welcome' | 'terminal' | 'sftp' | 'sql' | 'table'

export interface WorkspaceTab {
  id: string
  type: WorkspaceTabType
  title: string
  connectionId?: string
  closable: boolean
  pinned?: boolean
}

const STORAGE_KEY = 'remotehub.workspace'
const welcomeTab: WorkspaceTab = { id: 'welcome', type: 'welcome', title: 'Workspace', closable: false }
const connectionTabTypes = new Set<WorkspaceTabType>(['terminal', 'sftp', 'sql'])

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<WorkspaceTab[]>([{ ...welcomeTab }])
  const activeId = ref('welcome')
  const secondaryId = ref<string | null>(null)
  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeId.value) || tabs.value[0])
  let nextTabId = 0

  watch([tabs, activeId, secondaryId], persist, { deep: true })

  function openConnection(connectionId: string, title: string, type: 'terminal' | 'sftp' | 'sql'): void {
    const id = `connection:${connectionId}:${++nextTabId}`
    tabs.value.push({ id, type, title, connectionId, closable: true })
    activate(id)
  }

  function activate(id: string): void {
    if (!tabs.value.some((tab) => tab.id === id)) return
    if (secondaryId.value === id) secondaryId.value = null
    activeId.value = id
  }

  function close(id: string, force = false): void {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    const tab = tabs.value[index]
    if (!tab?.closable || (tab.pinned && !force)) return
    tabs.value.splice(index, 1)
    if (secondaryId.value === id) secondaryId.value = null
    if (activeId.value === id) activeId.value = tabs.value[Math.max(0, index - 1)]?.id || 'welcome'
  }

  function togglePinned(id = activeId.value): void {
    const tab = tabs.value.find((item) => item.id === id)
    if (tab?.closable) tab.pinned = !tab.pinned
  }

  function closeOthers(id = activeId.value): void {
    tabs.value.filter((tab) => tab.id !== id && tab.closable && !tab.pinned).forEach((tab) => close(tab.id))
    activate(id)
  }

  function closeRight(id = activeId.value): void {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    tabs.value.slice(index + 1).filter((tab) => tab.closable && !tab.pinned).forEach((tab) => close(tab.id))
  }

  function closeAll(): void {
    tabs.value.filter((tab) => tab.closable && !tab.pinned).forEach((tab) => close(tab.id))
  }

  function openSplit(id = activeId.value): void {
    const index = tabs.value.findIndex((tab) => tab.id === id && tab.closable)
    if (index < 0) return
    secondaryId.value = id
    if (activeId.value === id) activeId.value = tabs.value.slice(0, index).reverse().find((tab) => tab.id !== id)?.id || 'welcome'
  }

  function closeSplit(): void {
    secondaryId.value = null
  }

  function isVisible(id: string): boolean {
    return activeId.value === id || secondaryId.value === id
  }

  function cycle(direction: 1 | -1): void {
    const index = tabs.value.findIndex((tab) => tab.id === activeId.value)
    activate(tabs.value[(index + direction + tabs.value.length) % tabs.value.length].id)
  }

  function removeConnection(connectionId: string): void {
    tabs.value.filter((tab) => tab.connectionId === connectionId).forEach((tab) => close(tab.id, true))
  }

  function restore(validConnectionIds: Iterable<string>, serialized?: string | null): void {
    const validIds = new Set(validConnectionIds)
    try {
      const state = JSON.parse(serialized === undefined ? localStorage.getItem(STORAGE_KEY) || '{}' : serialized || '{}') as Record<string, unknown>
      const restored = Array.isArray(state.tabs) ? state.tabs.filter((value): value is Record<string, unknown> => {
        if (!value || typeof value !== 'object') return false
        return typeof value.id === 'string' && typeof value.title === 'string' && typeof value.connectionId === 'string'
          && connectionTabTypes.has(value.type as WorkspaceTabType) && validIds.has(value.connectionId)
      }).map((value) => ({
        id: value.id as string,
        type: value.type as WorkspaceTabType,
        title: value.title as string,
        connectionId: value.connectionId as string,
        closable: true,
        pinned: value.pinned === true
      })) : []
      const unique = restored.filter((tab, index) => restored.findIndex((item) => item.id === tab.id) === index)
      tabs.value = [{ ...welcomeTab }, ...unique]
      activeId.value = typeof state.activeId === 'string' && tabs.value.some((tab) => tab.id === state.activeId) ? state.activeId : 'welcome'
      secondaryId.value = typeof state.secondaryId === 'string' && state.secondaryId !== activeId.value && tabs.value.some((tab) => tab.id === state.secondaryId) ? state.secondaryId : null
      nextTabId = Math.max(0, ...unique.map((tab) => Number(tab.id.match(/:(\d+)$/)?.[1] || 0)))
    } catch {
      tabs.value = [{ ...welcomeTab }]
      activeId.value = 'welcome'
      secondaryId.value = null
    }
  }

  function persist(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: tabs.value.filter((tab) => tab.closable), activeId: activeId.value, secondaryId: secondaryId.value }))
  }

  return { tabs, activeId, secondaryId, activeTab, openConnection, activate, close, togglePinned, closeOthers, closeRight, closeAll, openSplit, closeSplit, isVisible, cycle, removeConnection, restore }
})
