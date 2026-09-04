import { randomUUID } from 'node:crypto'
import type { DatabaseConnectResult, DatabaseQueryRequest, DatabaseQueryResult, DatabaseCatalog, DatabaseTable, DatabaseColumn } from '../../../shared/database'
import type { Connection, ConnectionTestResult } from '../../../shared/types'
import type { SessionConnectionStatusEvent } from '../../../shared/connection-status'
import { CredentialService } from '../credentials'
import { appError, StorageService } from '../storage'
import type { DatabaseAdapter, DatabaseAdapterFactory } from './adapter'
import { mapMysqlError, mysqlAdapterFactory } from './mysql'
import { mapPostgresError, postgresAdapterFactory } from './postgres'
import { mapSqliteError, sqliteAdapterFactory } from './sqlite'

type DatabaseSession = { id: string; connectionId: string; adapter: DatabaseAdapter; busy: boolean; unsubscribe?: () => void }

export class DatabaseService {
  private readonly sessions = new Map<string, DatabaseSession>()

  constructor(
    private readonly storage: StorageService,
    private readonly credentials: CredentialService,
    private readonly mysqlFactory: DatabaseAdapterFactory = mysqlAdapterFactory,
    private readonly postgresFactory: DatabaseAdapterFactory = postgresAdapterFactory,
    private readonly sqliteFactory: DatabaseAdapterFactory = sqliteAdapterFactory,
    private readonly onStatus?: (event: SessionConnectionStatusEvent) => void
  ) {}

  async connect(connection: Connection): Promise<DatabaseConnectResult> {
    if (connection.type !== 'database') throw appError('DATABASE_CONNECTION_INVALID', 'A database connection is required')
    const adapter = await this.connectAdapter(connection)
    const sessionId = randomUUID()
    try { this.storage.markConnected(connection.id, Date.now()) } catch (error) { adapter.close(); throw error }
    const session: DatabaseSession = { id: sessionId, connectionId: connection.id, adapter, busy: false }
    this.sessions.set(sessionId, session)
    if (adapter.onStatus) {
      const unsubscribe = adapter.onStatus((event) => {
        if (this.sessions.get(sessionId) !== session) return
        if (event.status === 'error' || event.status === 'closed') {
          this.sessions.delete(sessionId)
          session.unsubscribe?.()
          // Tear down the transport/tunnel without overwriting the terminal reason.
          try { adapter.close() } catch { /* the terminated session is already removed */ }
        }
        this.notifyStatus({ sessionId, ...event })
      })
      // A retained terminal event may be replayed before subscribe returns.
      if (this.sessions.get(sessionId) === session) session.unsubscribe = unsubscribe
      else unsubscribe()
    } else this.notifyStatus({ sessionId, status: 'connected' })
    return { sessionId, adapter: adapter.type, database: adapter.database, serverVersion: adapter.serverVersion }
  }

  async test(connection: Connection, credential?: string): Promise<ConnectionTestResult> {
    const startedAt = Date.now()
    let adapter: DatabaseAdapter | undefined
    try {
      if (connection.type !== 'database') throw appError('DATABASE_ADAPTER_UNAVAILABLE', 'Database adapter is not available')
      adapter = await this.connectAdapter(connection, credential)
      await adapter.ping()
      return { ok: true, code: 'OK', message: `${adapter.type === 'postgres' ? 'PostgreSQL authentication' : adapter.type === 'mysql' ? 'MySQL authentication' : 'SQLite file'} succeeded`, latencyMs: Date.now() - startedAt, testedAt: Date.now() }
    } catch (error) {
      const failure = connection.databaseType === 'postgres' ? mapPostgresError(error) : connection.databaseType === 'sqlite' ? mapSqliteError(error) : mapMysqlError(error)
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
    session.unsubscribe?.()
    try { session.adapter.close() } finally { this.notifyStatus({ sessionId, status: 'closed' }) }
  }

  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) this.disconnect(sessionId)
  }

  private notifyStatus(event: SessionConnectionStatusEvent): void {
    try { this.onStatus?.(event) } catch { /* renderer may already be destroyed */ }
  }

  private getSession(sessionId: string): DatabaseSession {
    if (typeof sessionId !== 'string' || sessionId.length > 100) throw appError('DATABASE_SESSION_INVALID', 'Database session identifier is invalid')
    const session = this.sessions.get(sessionId)
    if (!session) throw appError('DATABASE_SESSION_NOT_FOUND', 'Database session is closed or missing')
    return session
  }

  private async connectAdapter(connection: Connection, credential?: string): Promise<DatabaseAdapter> {
    const factory = connection.databaseType === 'mysql' ? this.mysqlFactory : connection.databaseType === 'postgres' ? this.postgresFactory : connection.databaseType === 'sqlite' ? this.sqliteFactory : undefined
    if (!factory) throw appError('DATABASE_ADAPTER_UNAVAILABLE', 'Database adapter is not available in this phase')
    if (!connection.sshTunnelId) return factory.connect(connection, credential ?? this.credentials.get(connection.credentialId))
    const tunnelConnection = this.storage.getConnection(connection.sshTunnelId)
    if (!tunnelConnection || tunnelConnection.type !== 'ssh') throw appError('DATABASE_TUNNEL_INVALID', 'Selected SSH tunnel connection does not exist')
    return factory.connect(connection, credential ?? this.credentials.get(connection.credentialId), {
      connection: tunnelConnection,
      credential: this.credentials.get(tunnelConnection.credentialId)
    })
  }
}
