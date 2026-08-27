import { ipcMain } from 'electron'
import { createConnection } from 'node:net'
import { connectionErrorCode } from '../../shared/connection'
import type { Connection, ConnectionOrderItem, ConnectionSaveRequest, ConnectionTestResult } from '../../shared/types'
import { CredentialService } from '../services/credentials'
import { appError, StorageService } from '../services/storage'

export function registerConnectionIpc(storage: StorageService, credentials: CredentialService, testSerial?: (path: string, baudRate: number) => Promise<ConnectionTestResult>, testDatabase?: (connection: Connection) => Promise<ConnectionTestResult>): void {
  ipcMain.handle('connections:list', () => ({ connections: storage.listConnections(), groups: storage.listGroups() }))
  ipcMain.handle('connections:save', (_event, request: ConnectionSaveRequest) => {
    if (!request || typeof request !== 'object' || !request.connection || typeof request.connection !== 'object') throw appError('INVALID_CONNECTION', 'Connection input is invalid')
    if (request.credential !== undefined && typeof request.credential !== 'string') throw appError('INVALID_CREDENTIAL', 'Credential is invalid')
    if (request.privateKeyPath !== undefined && typeof request.privateKeyPath !== 'string') throw appError('PRIVATE_KEY_FILE_INVALID', 'Private key file path is invalid')
    storage.validateConnection(request.connection)
    const previousCredentialId = request.connection.credentialId
    const credentialId = request.connection.type === 'serial'
      ? undefined
      : request.privateKeyPath
        ? credentials.savePrivateKeyFile(request.connection.name, request.privateKeyPath, previousCredentialId)
        : request.credential
      ? credentials.save(request.connection.name, request.credential, previousCredentialId)
      : request.clearCredential ? undefined : previousCredentialId
    const connection = storage.saveConnection({ ...request.connection, credentialId })
    if ((request.clearCredential || request.connection.type === 'serial') && previousCredentialId && !storage.hasCredentialReference(previousCredentialId)) credentials.delete(previousCredentialId)
    return connection
  })
  ipcMain.handle('connections:delete', (_event, id: string) => {
    const credentialId = storage.getConnection(id)?.credentialId
    storage.deleteConnection(id)
    if (credentialId && !storage.hasCredentialReference(credentialId)) credentials.delete(credentialId)
    return { ok: true }
  })
  ipcMain.handle('connections:duplicate', (_event, id: string) => storage.duplicateConnection(id))
  ipcMain.handle('connections:reorder', (_event, items: ConnectionOrderItem[]) => storage.reorderConnections(items))
  ipcMain.handle('connections:test', async (_event, id: string) => {
    const connection = storage.getConnection(id)
    if (!connection) return { ok: false, code: 'CONNECTION_FAILED', message: 'Connection not found', latencyMs: 0, testedAt: Date.now() } satisfies ConnectionTestResult
    const result = connection.type === 'serial' && testSerial
      ? await testSerial(connection.host, connection.port)
      : connection.type === 'database' && (connection.databaseType === 'mysql' || connection.databaseType === 'postgres') && testDatabase
        ? await testDatabase(connection)
        : await testTcpConnection(connection.host, connection.port)
    if (result.ok) storage.markConnected(id, result.testedAt)
    return result
  })
  ipcMain.handle('groups:save', (_event, name: string, id?: string) => storage.saveGroup(name, id))
  ipcMain.handle('groups:delete', (_event, id: string) => {
    storage.deleteGroup(id)
    return { ok: true }
  })
}

function testTcpConnection(host: string, port: number): Promise<ConnectionTestResult> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let done = false
    const finish = (ok: boolean, code: ConnectionTestResult['code'], message: string): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve({ ok, code, message, latencyMs: Date.now() - startedAt, testedAt: Date.now() })
    }
    socket.setTimeout(5000)
    socket.once('connect', () => finish(true, 'OK', 'Connection succeeded'))
    socket.once('timeout', () => finish(false, 'CONNECTION_TIMEOUT', 'Connection timed out'))
    socket.once('error', (error: NodeJS.ErrnoException) => finish(false, connectionErrorCode(error.code), error.message))
  })
}
