import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionInput } from '../shared/types'

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo')
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (input: ConnectionInput) => ipcRenderer.invoke('connections:save', input),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type RemoteHubApi = typeof api
