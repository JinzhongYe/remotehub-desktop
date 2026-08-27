import { ipcMain } from 'electron'
import type { SftpService } from '../services/sftp'
import type { StorageService } from '../services/storage'
import { appError } from '../services/storage'

export function registerSftpIpc(storage: StorageService, sftp: SftpService): void {
  ipcMain.handle('sftp:connect', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 100) throw appError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    const connection = storage.getConnection(connectionId)
    if (!connection) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    return sftp.connect(connection)
  })
  ipcMain.handle('sftp:trustHostKey', (_event, connectionId: string, fingerprint: string) => {
    sftp.trustHostKey(connectionId, fingerprint)
    return { ok: true }
  })
  ipcMain.handle('sftp:list', (_event, sessionId: string, path: string) => sftp.list(sessionId, path))
  ipcMain.handle('sftp:mkdir', async (_event, sessionId: string, path: string) => { await sftp.mkdir(sessionId, path); return { ok: true } })
  ipcMain.handle('sftp:rename', async (_event, sessionId: string, oldPath: string, newPath: string) => { await sftp.rename(sessionId, oldPath, newPath); return { ok: true } })
  ipcMain.handle('sftp:remove', async (_event, sessionId: string, path: string, type: 'file' | 'directory' | 'link') => { await sftp.remove(sessionId, path, type); return { ok: true } })
  ipcMain.handle('sftp:upload', (_event, sessionId: string, localPath: string, remoteDirectory: string) => sftp.upload(sessionId, localPath, remoteDirectory))
  ipcMain.handle('sftp:download', (_event, sessionId: string, remotePath: string, localPath: string, size: number) => sftp.download(sessionId, remotePath, localPath, size))
  ipcMain.handle('sftp:disconnect', (_event, sessionId: string) => { sftp.disconnect(sessionId); return { ok: true } })
}
