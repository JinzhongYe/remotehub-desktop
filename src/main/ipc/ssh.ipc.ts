import { ipcMain } from 'electron'
import type { SshService } from '../services/ssh'
import type { StorageService } from '../services/storage'

export function registerSshIpc(storage: StorageService, ssh: SshService): void {
  ipcMain.handle('ssh:connect', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 100) throw storageError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    const connection = storage.getConnection(connectionId)
    if (!connection) throw storageError('CONNECTION_NOT_FOUND', 'Connection not found')
    return ssh.connect(connection)
  })
  ipcMain.handle('ssh:trustHostKey', (_event, connectionId: string, fingerprint: string) => {
    ssh.trustHostKey(connectionId, fingerprint)
    return { ok: true }
  })
  ipcMain.handle('ssh:write', (_event, sessionId: string, data: string) => {
    ssh.write(sessionId, data)
    return { ok: true }
  })
  ipcMain.handle('ssh:resize', (_event, sessionId: string, cols: number, rows: number) => {
    ssh.resize(sessionId, cols, rows)
    return { ok: true }
  })
  ipcMain.handle('ssh:statusOverview', (_event, sessionId: string) => ssh.status(sessionId))
  ipcMain.handle('ssh:codexStatus', (_event, sessionId: string) => ssh.codexStatus(sessionId))
  ipcMain.handle('ssh:disconnect', (_event, sessionId: string) => {
    ssh.disconnect(sessionId)
    return { ok: true }
  })
}

function storageError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
