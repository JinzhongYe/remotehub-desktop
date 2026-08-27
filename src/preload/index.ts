import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionOrderItem, ConnectionSaveRequest } from '../shared/types'

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo')
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (request: ConnectionSaveRequest) => ipcRenderer.invoke('connections:save', request),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
    duplicate: (id: string) => ipcRenderer.invoke('connections:duplicate', id),
    reorder: (items: ConnectionOrderItem[]) => ipcRenderer.invoke('connections:reorder', items),
    test: (id: string) => ipcRenderer.invoke('connections:test', id)
  },
  groups: {
    save: (name: string, id?: string) => ipcRenderer.invoke('groups:save', name, id),
    delete: (id: string) => ipcRenderer.invoke('groups:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type RemoteHubApi = typeof api
