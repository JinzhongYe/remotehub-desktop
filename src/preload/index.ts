import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionOrderItem, ConnectionSaveRequest } from '../shared/types'
import type { SshDataEvent, SshStatusEvent } from '../shared/ssh'

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    copyText: (text: string) => ipcRenderer.invoke('app:copyText', text)
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (request: ConnectionSaveRequest) => ipcRenderer.invoke('connections:save', request),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
    duplicate: (id: string) => ipcRenderer.invoke('connections:duplicate', id),
    reorder: (items: ConnectionOrderItem[]) => ipcRenderer.invoke('connections:reorder', items),
    test: (id: string) => ipcRenderer.invoke('connections:test', id)
  },
  ssh: {
    connect: (connectionId: string) => ipcRenderer.invoke('ssh:connect', connectionId),
    trustHostKey: (connectionId: string, fingerprint: string) => ipcRenderer.invoke('ssh:trustHostKey', connectionId, fingerprint),
    write: (sessionId: string, data: string) => ipcRenderer.invoke('ssh:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:resize', sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.invoke('ssh:disconnect', sessionId),
    onData: (listener: (event: SshDataEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SshDataEvent): void => listener(payload)
      ipcRenderer.on('ssh:data', handler)
      return () => ipcRenderer.removeListener('ssh:data', handler)
    },
    onStatus: (listener: (event: SshStatusEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SshStatusEvent): void => listener(payload)
      ipcRenderer.on('ssh:status', handler)
      return () => ipcRenderer.removeListener('ssh:status', handler)
    }
  },
  groups: {
    save: (name: string, id?: string) => ipcRenderer.invoke('groups:save', name, id),
    delete: (id: string) => ipcRenderer.invoke('groups:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type RemoteHubApi = typeof api
