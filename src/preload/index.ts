import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ConnectionOrderItem, ConnectionSaveRequest } from '../shared/types'
import type { SshDataEvent, SshStatusEvent } from '../shared/ssh'
import type { SftpTransferEvent } from '../shared/sftp'
import type { SerialDataEvent, SerialStatusEvent } from '../shared/serial'
import type { DatabaseQueryRequest } from '../shared/database'

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    copyText: (text: string) => ipcRenderer.invoke('app:copyText', text),
    choosePrivateKey: () => ipcRenderer.invoke('app:choosePrivateKey'),
    chooseUploadFiles: () => ipcRenderer.invoke('app:chooseUploadFiles'),
    chooseUploadFolder: () => ipcRenderer.invoke('app:chooseUploadFolder'),
    chooseDownloadPath: (defaultName: string) => ipcRenderer.invoke('app:chooseDownloadPath', defaultName),
    chooseDownloadDirectory: () => ipcRenderer.invoke('app:chooseDownloadDirectory')
  },
  files: {
    getPath: (file: File) => webUtils.getPathForFile(file)
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
  sftp: {
    connect: (connectionId: string) => ipcRenderer.invoke('sftp:connect', connectionId),
    trustHostKey: (connectionId: string, fingerprint: string) => ipcRenderer.invoke('sftp:trustHostKey', connectionId, fingerprint),
    list: (sessionId: string, path: string) => ipcRenderer.invoke('sftp:list', sessionId, path),
    mkdir: (sessionId: string, path: string) => ipcRenderer.invoke('sftp:mkdir', sessionId, path),
    rename: (sessionId: string, oldPath: string, newPath: string) => ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),
    remove: (sessionId: string, path: string, type: 'file' | 'directory' | 'link') => ipcRenderer.invoke('sftp:remove', sessionId, path, type),
    enqueueUploads: (sessionId: string, localPaths: string[], remoteDirectory: string, overwrite = false) => ipcRenderer.invoke('sftp:enqueueUploads', sessionId, localPaths, remoteDirectory, overwrite),
    enqueueDownload: (sessionId: string, remotePath: string, localDirectory: string, entryType: 'file' | 'directory' | 'link', overwrite = false) => ipcRenderer.invoke('sftp:enqueueDownload', sessionId, remotePath, localDirectory, entryType, overwrite),
    listTransfers: (sessionId: string) => ipcRenderer.invoke('sftp:listTransfers', sessionId),
    pauseTransfer: (sessionId: string, transferId: string) => ipcRenderer.invoke('sftp:pauseTransfer', sessionId, transferId),
    resumeTransfer: (sessionId: string, transferId: string) => ipcRenderer.invoke('sftp:resumeTransfer', sessionId, transferId),
    cancelTransfer: (sessionId: string, transferId: string) => ipcRenderer.invoke('sftp:cancelTransfer', sessionId, transferId),
    retryTransfer: (sessionId: string, transferId: string) => ipcRenderer.invoke('sftp:retryTransfer', sessionId, transferId),
    clearFinishedTransfers: (sessionId: string) => ipcRenderer.invoke('sftp:clearFinishedTransfers', sessionId),
    disconnect: (sessionId: string) => ipcRenderer.invoke('sftp:disconnect', sessionId),
    onTransfer: (listener: (event: SftpTransferEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SftpTransferEvent): void => listener(payload)
      ipcRenderer.on('sftp:transfer', handler)
      return () => ipcRenderer.removeListener('sftp:transfer', handler)
    }
  },
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:listPorts'),
    connect: (connectionId: string) => ipcRenderer.invoke('serial:connect', connectionId),
    write: (sessionId: string, data: string) => ipcRenderer.invoke('serial:write', sessionId, data),
    disconnect: (sessionId: string) => ipcRenderer.invoke('serial:disconnect', sessionId),
    onData: (listener: (event: SerialDataEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SerialDataEvent): void => listener(payload)
      ipcRenderer.on('serial:data', handler)
      return () => ipcRenderer.removeListener('serial:data', handler)
    },
    onStatus: (listener: (event: SerialStatusEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SerialStatusEvent): void => listener(payload)
      ipcRenderer.on('serial:status', handler)
      return () => ipcRenderer.removeListener('serial:status', handler)
    }
  },
  database: {
    connect: (connectionId: string) => ipcRenderer.invoke('database:connect', connectionId),
    listDatabases: (sessionId: string) => ipcRenderer.invoke('database:listDatabases', sessionId),
    useDatabase: (sessionId: string, name: string) => ipcRenderer.invoke('database:useDatabase', sessionId, name),
    listTables: (sessionId: string, name: string) => ipcRenderer.invoke('database:listTables', sessionId, name),
    listColumns: (sessionId: string, name: string, table: string) => ipcRenderer.invoke('database:listColumns', sessionId, name, table),
    query: (sessionId: string, request: DatabaseQueryRequest) => ipcRenderer.invoke('database:query', sessionId, request),
    disconnect: (sessionId: string) => ipcRenderer.invoke('database:disconnect', sessionId)
  },
  groups: {
    save: (name: string, id?: string) => ipcRenderer.invoke('groups:save', name, id),
    delete: (id: string) => ipcRenderer.invoke('groups:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type RemoteHubApi = typeof api
