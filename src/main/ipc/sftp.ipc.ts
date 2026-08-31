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
  ipcMain.handle('sftp:readText', (_event, sessionId: string, path: string) => sftp.readText(sessionId, path))
  ipcMain.handle('sftp:writeText', (_event, sessionId: string, path: string, content: string, expectedModifiedAt: number) => sftp.writeText(sessionId, path, content, expectedModifiedAt))
  ipcMain.handle('sftp:remove', async (_event, sessionId: string, path: string, type: 'file' | 'directory' | 'link') => { await sftp.remove(sessionId, path, type); return { ok: true } })
  ipcMain.handle('sftp:enqueueUploads', (_event, sessionId: string, localPaths: string[], remoteDirectory: string, overwrite: boolean) => sftp.enqueueUploads(sessionId, localPaths, remoteDirectory, Boolean(overwrite)))
  ipcMain.handle('sftp:enqueueDownload', (_event, sessionId: string, remotePath: string, localDirectory: string, entryType: 'file' | 'directory' | 'link', overwrite: boolean) => sftp.enqueueDownload(sessionId, remotePath, localDirectory, entryType, Boolean(overwrite)))
  ipcMain.handle('sftp:listTransfers', (_event, sessionId: string) => sftp.listTransfers(sessionId))
  ipcMain.handle('sftp:pauseTransfer', (_event, sessionId: string, transferId: string) => sftp.pauseTransfer(sessionId, transferId))
  ipcMain.handle('sftp:resumeTransfer', (_event, sessionId: string, transferId: string) => sftp.resumeTransfer(sessionId, transferId))
  ipcMain.handle('sftp:cancelTransfer', (_event, sessionId: string, transferId: string) => sftp.cancelTransfer(sessionId, transferId))
  ipcMain.handle('sftp:retryTransfer', (_event, sessionId: string, transferId: string) => sftp.retryTransfer(sessionId, transferId))
  ipcMain.handle('sftp:clearFinishedTransfers', (_event, sessionId: string) => { sftp.clearFinishedTransfers(sessionId); return { ok: true } })
  ipcMain.handle('sftp:disconnect', (_event, sessionId: string) => { sftp.disconnect(sessionId); return { ok: true } })
}
