import { ipcMain } from 'electron'
import type { LocalShellService } from '../services/local-shell'
import type { StorageService } from '../services/storage'
import { appError } from '../services/storage'

export function registerLocalShellIpc(storage: StorageService, shell: LocalShellService): void {
  ipcMain.handle('shell:connect', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 100) throw appError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    const connection = storage.getConnection(connectionId)
    if (!connection) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    return shell.connect(connection)
  })
  ipcMain.handle('shell:write', async (_event, sessionId: string, data: string) => { await shell.write(sessionId, data); return { ok: true } })
  ipcMain.handle('shell:resize', (_event, sessionId: string, cols: number, rows: number) => { shell.resize(sessionId, cols, rows); return { ok: true } })
  ipcMain.handle('shell:codexStatus', (_event, sessionId: string) => shell.codexStatus(sessionId))
  ipcMain.handle('shell:disconnect', (_event, sessionId: string) => { shell.disconnect(sessionId); return { ok: true } })
}
