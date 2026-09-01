import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Connection, ConnectionInput, ConnectionTestResult, Group } from '../../shared/types'

export const useConnectionStore = defineStore('connections', () => {
  const connections = ref<Connection[]>([])
  const groups = ref<Group[]>([])
  const selectedId = ref<string | null>(null)
  const search = ref('')
  const loading = ref(false)

  const filteredConnections = computed(() => {
    const query = search.value.trim().toLocaleLowerCase()
    if (!query) return connections.value
    return connections.value.filter((item) => [item.name, item.host, item.database, item.databaseType].filter(Boolean).join(' ').toLocaleLowerCase().includes(query))
  })
  const selected = computed(() => connections.value.find((item) => item.id === selectedId.value) || null)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const result = await window.api.connections.list()
      connections.value = result.connections
      groups.value = result.groups
      if (!selectedId.value && connections.value.length) selectedId.value = connections.value[0].id
    } finally {
      loading.value = false
    }
  }

  async function save(input: ConnectionInput, credential?: string, clearCredential = false, privateKeyPath?: string): Promise<Connection> {
    const item = await window.api.connections.save({ connection: input, credential, clearCredential, privateKeyPath })
    const index = connections.value.findIndex((connection) => connection.id === item.id)
    if (index >= 0) connections.value[index] = item
    else connections.value.unshift(item)
    selectedId.value = item.id
    return item
  }

  async function duplicate(id: string): Promise<void> {
    const item = await window.api.connections.duplicate(id)
    connections.value.push(item)
    selectedId.value = item.id
  }

  async function importConnections(): Promise<{ canceled: boolean; count: number }> {
    const result = await window.api.connections.import()
    if (!result.canceled) await load()
    return result
  }

  function exportConnections(): Promise<{ canceled: boolean; count: number }> {
    return window.api.connections.export()
  }

  async function move(id: string, beforeId?: string, groupId?: string): Promise<void> {
    const previous = [...connections.value]
    const items = connections.value.map((item) => ({ ...item }))
    const index = items.findIndex((item) => item.id === id)
    if (index < 0 || id === beforeId) return
    const [item] = items.splice(index, 1)
    item.groupId = groupId
    const targetIndex = beforeId ? items.findIndex((connection) => connection.id === beforeId) : items.length
    items.splice(targetIndex < 0 ? items.length : targetIndex, 0, item)
    connections.value = items
    try {
      connections.value = await window.api.connections.reorder(items.map((connection) => ({ id: connection.id, groupId: connection.groupId })))
    } catch (error) {
      connections.value = previous
      throw error
    }
  }

  async function test(id: string): Promise<ConnectionTestResult> {
    const result = await window.api.connections.test(id)
    if (result.ok) {
      const item = connections.value.find((connection) => connection.id === id)
      if (item) item.lastConnectedAt = result.testedAt
    }
    return result
  }

  async function saveGroup(name: string, id?: string): Promise<void> {
    const group = await window.api.groups.save(name, id)
    const index = groups.value.findIndex((item) => item.id === group.id)
    if (index >= 0) groups.value[index] = group
    else groups.value.push(group)
  }

  async function deleteGroup(id: string): Promise<void> {
    await window.api.groups.delete(id)
    groups.value = groups.value.filter((item) => item.id !== id)
    connections.value.forEach((item) => { if (item.groupId === id) item.groupId = undefined })
  }

  async function remove(id: string): Promise<void> {
    await window.api.connections.delete(id)
    connections.value = connections.value.filter((item) => item.id !== id)
    if (selectedId.value === id) selectedId.value = connections.value[0]?.id || null
  }

  function select(id: string): void {
    selectedId.value = id
  }

  return { connections, groups, selectedId, search, loading, filteredConnections, selected, load, save, remove, duplicate, importConnections, exportConnections, move, test, saveGroup, deleteGroup, select }
})
