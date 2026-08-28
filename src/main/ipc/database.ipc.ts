import { dialog, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import type { DatabaseCsvExport, DatabaseQueryRequest } from '../../shared/database'
import { databaseResultToCsv } from '../../shared/database'
import type { DatabaseService } from '../services/database'
import type { StorageService } from '../services/storage'
import { appError } from '../services/storage'

export function registerDatabaseIpc(storage: StorageService, database: DatabaseService): void {
  ipcMain.handle('database:connect', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string' || connectionId.length > 100) throw appError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    const connection = storage.getConnection(connectionId)
    if (!connection) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    return database.connect(connection)
  })
  ipcMain.handle('database:listDatabases', (_event, sessionId: string) => database.listDatabases(sessionId))
  ipcMain.handle('database:useDatabase', (_event, sessionId: string, name: string) => database.useDatabase(sessionId, name))
  ipcMain.handle('database:listTables', (_event, sessionId: string, name: string) => database.listTables(sessionId, name))
  ipcMain.handle('database:listColumns', (_event, sessionId: string, name: string, table: string) => database.listColumns(sessionId, name, table))
  ipcMain.handle('database:query', (_event, sessionId: string, request: DatabaseQueryRequest) => database.query(sessionId, request))
  ipcMain.handle('database:exportCsv', async (_event, request: DatabaseCsvExport) => {
    const csv = databaseResultToCsv(request)
    if (csv.length > 10 * 1024 * 1024) throw appError('DATABASE_EXPORT_TOO_LARGE', 'CSV export is limited to 10 MB')
    const fileName = typeof request.fileName === 'string' && request.fileName.length <= 200 ? request.fileName.replace(/[\\/:*?"<>|]/g, '-') : 'remotehub-results.csv'
    const result = await dialog.showSaveDialog({ title: 'Export query results', defaultPath: fileName, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, `\uFEFF${csv}`, 'utf8')
    return result.filePath
  })
  ipcMain.handle('database:disconnect', (_event, sessionId: string) => { database.disconnect(sessionId); return { ok: true } })
}
