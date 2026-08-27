import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type WorkspaceTabType = 'welcome' | 'terminal' | 'sftp' | 'sql' | 'table'

export interface WorkspaceTab {
  id: string
  type: WorkspaceTabType
  title: string
  connectionId?: string
  closable: boolean
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<WorkspaceTab[]>([{ id: 'welcome', type: 'welcome', title: 'Workspace', closable: false }])
  const activeId = ref('welcome')
  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeId.value) || tabs.value[0])
  let nextTabId = 0

  function openConnection(connectionId: string, title: string, type: 'terminal' | 'sftp' | 'sql'): void {
    const id = `connection:${connectionId}:${++nextTabId}`
    tabs.value.push({ id, type, title, connectionId, closable: true })
    activeId.value = id
  }

  function close(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index < 0 || !tabs.value[index].closable) return
    tabs.value.splice(index, 1)
    if (activeId.value === id) activeId.value = tabs.value[Math.max(0, index - 1)]?.id || 'welcome'
  }

  return { tabs, activeId, activeTab, openConnection, close }
})
