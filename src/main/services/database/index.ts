import { randomUUID } from 'node:crypto'
import type { DatabaseConnectResult, DatabaseQueryRequest, DatabaseQueryResult, DatabaseCatalog, DatabaseTable, DatabaseColumn } from '../../../shared/database'
import type { Connection, ConnectionTestResult } from '../../../shared/types'
import { CredentialService } from '../credentials'
import { appError, StorageService } from '../storage'
import type { DatabaseAdapter, DatabaseAdapterFactory } from './adapter'
import { mapMysqlError, mysqlAdapterFactory } from './mysql'

type DatabaseSession = { id: string; connectionId: string; adapter: DatabaseAdapter; busy: boolean }

export class DatabaseService {
  private readonly sessions = new Map<string, DatabaseSession>()

  constructor(private readonly storage: StorageService, private readonly credentials: CredentialService, private readonly mysqlFactory: DatabaseAdapterFactory = mysqlAdapterFactory) {}

  async connect(connection: Connection): Promise<DatabaseConnectResult> {
    if (connection.type !== 'database') throw appError('DATABASE_CONNECTION_INVALID', 'A database connection is required')
    if (connection.databaseType !== 'mysql') throw appError('DATABASE_ADAPTER_UNAVAILABLE', 'Phase 6 supports MySQL connections only')
    const adapter = await this.mysqlFactory.connect(connection, this.credentials.get(connection.credentialId))
    const sessionId = randomUUID()
    try { this.storage.markConnected(connection.id, Date.now()) } catch (error) { adapter.close(); throw error }
    this.sessions.set(sessionId, { id: sessionId, connectionId: connection.id, adapter, busy: false })
    return { sessionId, adapter: adapter.type, database: adapter.database, serverVersion: adapter.serverVersion }
  }

  async test(connection: Connection): Promise<ConnectionTestResult> {
    const startedAt = Date.now()
    let adapter: DatabaseAdapter | undefined
    try {
      if (connection.type !== 'database' || connection.databaseType !== 'mysql') throw appError('DATABASE_ADAPTER_UNAVAILABLE', 'Database adapter is not available in this phase')
      adapter = await this.mysqlFactory.connect(connection, this.credentials.get(connection.credentialId))
      await adapter.ping()
      return { ok: true, code: 'OK', message: 'MySQL authentication succeeded', latencyMs: Date.now() - startedAt, testedAt: Date.now() }
    } catch (error) {
      const failure = mapMysqlError(error)
      const code: ConnectionTestResult['code'] = failure.code === 'DATABASE_AUTH_FAILED' ? 'AUTHENTICATION_FAILED'
        : failure.code === 'DATABASE_NOT_FOUND' ? 'DATABASE_NOT_FOUND'
          : failure.code === 'DATABASE_TIMEOUT' ? 'CONNECTION_TIMEOUT'
            : failure.code === 'DATABASE_HOST_NOT_FOUND' ? 'HOST_NOT_FOUND'
              : failure.code === 'DATABASE_CONNECTION_REFUSED' ? 'CONNECTION_REFUSED'
                : 'DATABASE_FAILED'
      return { ok: false, code, message: failure.message, latencyMs: Date.now() - startedAt, testedAt: Date.now() }
    } finally { adapter?.close() }
  }

  listDatabases(sessionId: string): Promise<DatabaseCatalog[]> {
    return this.getSession(sessionId).adapter.listDatabases()
  }

  async useDatabase(sessionId: string, database: string): Promise<{ database: string }> {
    const session = this.getSession(sessionId)
    await session.adapter.useDatabase(database)
    return { database: session.adapter.database || database }
  }

  listTables(sessionId: string, database: string): Promise<DatabaseTable[]> {
    return this.getSession(sessionId).adapter.listTables(database)
  }

  listColumns(sessionId: string, database: string, table: string): Promise<DatabaseColumn[]> {
    return this.getSession(sessionId).adapter.listColumns(database, table)
  }

  async query(sessionId: string, request: DatabaseQueryRequest): Promise<DatabaseQueryResult> {
    const session = this.getSession(sessionId)
    if (session.busy) throw appError('DATABASE_BUSY', 'Another query is still running in this workspace')
    session.busy = true
    try { return await session.adapter.query(request) } finally { session.busy = false }
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.adapter.close()
  }

  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) this.disconnect(sessionId)
  }

  private getSession(sessionId: string): DatabaseSession {
    if (typeof sessionId !== 'string' || sessionId.length > 100) throw appError('DATABASE_SESSION_INVALID', 'Database session identifier is invalid')
    const session = this.sessions.get(sessionId)
    if (!session) throw appError('DATABASE_SESSION_NOT_FOUND', 'Database session is closed or missing')
    return session
  }
}
