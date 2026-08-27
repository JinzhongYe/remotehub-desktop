import type { DatabaseCatalog, DatabaseColumn, DatabaseQueryRequest, DatabaseQueryResult, DatabaseTable } from '../../../shared/database'
import type { Connection } from '../../../shared/types'

export interface DatabaseAdapter {
  readonly type: 'mysql'
  readonly database?: string
  readonly serverVersion: string
  ping(): Promise<void>
  listDatabases(): Promise<DatabaseCatalog[]>
  useDatabase(database: string): Promise<void>
  listTables(database: string): Promise<DatabaseTable[]>
  listColumns(database: string, table: string): Promise<DatabaseColumn[]>
  query(request: DatabaseQueryRequest): Promise<DatabaseQueryResult>
  close(): void
}

export interface DatabaseAdapterFactory {
  connect(connection: Connection, password?: string): Promise<DatabaseAdapter>
}
