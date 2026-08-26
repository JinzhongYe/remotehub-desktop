import { ipcMain } from 'electron'
import type { ConnectionInput } from '../../shared/types'
import { StorageService } from '../services/storage'

export function registerConnectionIpc(storage: StorageService): void {
  ipcMain.handle('connections:list', () => ({ connections: storage.listConnections(), groups: storage.listGroups() }))
  ipcMain.handle('connections:save', (_event, input: ConnectionInput) => storage.saveConnection(input))
  ipcMain.handle('connections:delete', (_event, id: string) => {
    storage.deleteConnection(id)
    return { ok: true }
  })
}
