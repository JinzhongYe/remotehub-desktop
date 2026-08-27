import { ipcMain } from 'electron'
import type { SerialService } from '../services/serial'
import type { StorageService } from '../services/storage'
import { appError } from '../services/storage'

export function registerSerialIpc(storage: StorageService, serial: SerialService): void {
  ipcMain.handle('serial:listPorts', () => serial.listPorts())
  ipcMain.handle('serial:connect', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 100) throw appError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    const connection = storage.getConnection(connectionId)
    if (!connection) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    return serial.connect(connection)
  })
  ipcMain.handle('serial:write', async (_event, sessionId: string, data: string) => { await serial.write(sessionId, data); return { ok: true } })
  ipcMain.handle('serial:disconnect', (_event, sessionId: string) => { serial.disconnect(sessionId); return { ok: true } })
}
