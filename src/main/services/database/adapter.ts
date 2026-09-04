import type { DatabaseCatalog, DatabaseColumn, DatabaseQueryRequest, DatabaseQueryResult, DatabaseTable } from '../../../shared/database'
import type { Connection } from '../../../shared/types'
import type { SessionConnectionStatusEvent } from '../../../shared/connection-status'

export type DatabaseStatusEvent = Omit<SessionConnectionStatusEvent, 'sessionId'>

export interface DatabaseTunnel {
  connection: Connection
  credential?: string
}

export interface DatabaseAdapter {
  readonly type: 'mysql' | 'postgres' | 'sqlite'
  readonly database?: string
  readonly serverVersion: string
  onStatus?(listener: (event: DatabaseStatusEvent) => void): () => void
  ping(): Promise<void>
  listDatabases(): Promise<DatabaseCatalog[]>
  useDatabase(database: string): Promise<void>
  listTables(database: string): Promise<DatabaseTable[]>
  listColumns(database: string, table: string): Promise<DatabaseColumn[]>
  query(request: DatabaseQueryRequest): Promise<DatabaseQueryResult>
  close(): void
}

export interface DatabaseAdapterFactory {
  connect(connection: Connection, password?: string, tunnel?: DatabaseTunnel): Promise<DatabaseAdapter>
}
