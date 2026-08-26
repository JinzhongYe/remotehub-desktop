import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Connection, ConnectionInput, Group } from '../../shared/types'

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

  async function save(input: ConnectionInput): Promise<Connection> {
    const item = await window.api.connections.save(input)
    const index = connections.value.findIndex((connection) => connection.id === item.id)
    if (index >= 0) connections.value[index] = item
    else connections.value.unshift(item)
    selectedId.value = item.id
    return item
  }

  async function remove(id: string): Promise<void> {
    await window.api.connections.delete(id)
    connections.value = connections.value.filter((item) => item.id !== id)
    if (selectedId.value === id) selectedId.value = connections.value[0]?.id || null
  }

  function select(id: string): void {
    selectedId.value = id
  }

  return { connections, groups, selectedId, search, loading, filteredConnections, selected, load, save, remove, select }
})
