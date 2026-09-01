import { ipcMain } from 'electron'
import type { SftpService } from '../services/sftp'
import type { FtpService } from '../services/ftp'
import type { StorageService } from '../services/storage'
import { appError } from '../services/storage'

export function registerSftpIpc(storage: StorageService, sftp: SftpService): void {
  registerFileTransferIpc('sftp', storage, sftp)
  ipcMain.handle('sftp:trustHostKey', (_event, connectionId: string, fingerprint: string) => {
    sftp.trustHostKey(connectionId, fingerprint)
    return { ok: true }
  })
}

export function registerFtpIpc(storage: StorageService, ftp: FtpService): void {
  registerFileTransferIpc('ftp', storage, ftp)
}

function registerFileTransferIpc(prefix: 'sftp' | 'ftp', storage: StorageService, service: SftpService | FtpService): void {
  ipcMain.handle(`${prefix}:connect`, (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 100) throw appError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    const connection = storage.getConnection(connectionId)
    if (!connection) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    return service.connect(connection)
  })
  ipcMain.handle(`${prefix}:list`, (_event, sessionId: string, path: string) => service.list(sessionId, path))
  ipcMain.handle(`${prefix}:mkdir`, async (_event, sessionId: string, path: string) => { await service.mkdir(sessionId, path); return { ok: true } })
  ipcMain.handle(`${prefix}:rename`, async (_event, sessionId: string, oldPath: string, newPath: string) => { await service.rename(sessionId, oldPath, newPath); return { ok: true } })
  ipcMain.handle(`${prefix}:readText`, (_event, sessionId: string, path: string) => service.readText(sessionId, path))
  ipcMain.handle(`${prefix}:writeText`, (_event, sessionId: string, path: string, content: string, expectedModifiedAt: number) => service.writeText(sessionId, path, content, expectedModifiedAt))
  ipcMain.handle(`${prefix}:remove`, async (_event, sessionId: string, path: string, type: 'file' | 'directory' | 'link') => { await service.remove(sessionId, path, type); return { ok: true } })
  ipcMain.handle(`${prefix}:enqueueUploads`, (_event, sessionId: string, localPaths: string[], remoteDirectory: string, overwrite: boolean) => service.enqueueUploads(sessionId, localPaths, remoteDirectory, Boolean(overwrite)))
  ipcMain.handle(`${prefix}:enqueueDownload`, (_event, sessionId: string, remotePath: string, localDirectory: string, entryType: 'file' | 'directory' | 'link', overwrite: boolean) => service.enqueueDownload(sessionId, remotePath, localDirectory, entryType, Boolean(overwrite)))
  ipcMain.handle(`${prefix}:listTransfers`, (_event, sessionId: string) => service.listTransfers(sessionId))
  ipcMain.handle(`${prefix}:pauseTransfer`, (_event, sessionId: string, transferId: string) => service.pauseTransfer(sessionId, transferId))
  ipcMain.handle(`${prefix}:resumeTransfer`, (_event, sessionId: string, transferId: string) => service.resumeTransfer(sessionId, transferId))
  ipcMain.handle(`${prefix}:cancelTransfer`, (_event, sessionId: string, transferId: string) => service.cancelTransfer(sessionId, transferId))
  ipcMain.handle(`${prefix}:retryTransfer`, (_event, sessionId: string, transferId: string) => service.retryTransfer(sessionId, transferId))
  ipcMain.handle(`${prefix}:clearFinishedTransfers`, (_event, sessionId: string) => { service.clearFinishedTransfers(sessionId); return { ok: true } })
  ipcMain.handle(`${prefix}:disconnect`, (_event, sessionId: string) => { service.disconnect(sessionId); return { ok: true } })
}
