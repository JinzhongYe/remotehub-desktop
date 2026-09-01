import { isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import type { DatabaseCatalog, DatabaseColumn, DatabaseQueryRequest, DatabaseQueryResult, DatabaseResultColumn, DatabaseTable } from '../../../shared/database'
import { databaseStatement, isPageableStatement, normalizeQueryRequest } from '../../../shared/database'
import type { DatabaseAdapter, DatabaseAdapterFactory } from './adapter'
import { buildPagedMysqlQuery, serializeDatabaseValue } from './mysql'

type BetterSqlite3 = typeof import('better-sqlite3')
const loadNativeModule = createRequire(__filename)

export const sqliteAdapterFactory: DatabaseAdapterFactory = {
  async connect(connection) {
    if (connection.type !== 'database' || connection.databaseType !== 'sqlite') throw sqliteError('DATABASE_ADAPTER_UNAVAILABLE', 'SQLite connection is required')
    if (!isAbsolute(connection.host) || connection.host.length > 4096) throw sqliteError('DATABASE_FILE_INVALID', 'Choose an absolute SQLite database file path')
    try {
      const BetterSqlite3Constructor = loadNativeModule('better-sqlite3') as BetterSqlite3
      const client = new BetterSqlite3Constructor(connection.host, { fileMustExist: true })
      const version = (client.prepare('SELECT sqlite_version() AS version').get() as { version?: string } | undefined)?.version || 'SQLite'
      return new SqliteAdapter(client, `SQLite ${version}`)
    } catch (error) { throw mapSqliteError(error) }
  }
}

export class SqliteAdapter implements DatabaseAdapter {
  readonly type = 'sqlite' as const
  database = 'main'

  constructor(private readonly client: Database.Database, public readonly serverVersion: string) {}

  async ping(): Promise<void> {
    try { this.client.prepare('SELECT 1').get() } catch (error) { throw mapSqliteError(error) }
  }

  async listDatabases(): Promise<DatabaseCatalog[]> {
    try {
      const rows = this.client.pragma('database_list') as { name: string }[]
      return rows.map(({ name }) => ({ name, system: name === 'temp' }))
    } catch (error) { throw mapSqliteError(error) }
  }

  async useDatabase(database: string): Promise<void> {
    const name = validateIdentifier(database, 'database')
    if (!(await this.listDatabases()).some((item) => item.name === name)) throw sqliteError('DATABASE_NOT_FOUND', `SQLite database “${name}” is not attached`)
    this.database = name
  }

  async listTables(database: string): Promise<DatabaseTable[]> {
    const name = validateIdentifier(database, 'database')
    try {
      const rows = this.client.prepare(`SELECT name, type FROM ${quoteIdentifier(name)}.sqlite_schema
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as { name: string; type: string }[]
      return rows.map((row) => ({ database: name, name: row.name, type: row.type === 'view' ? 'view' : 'table' }))
    } catch (error) { throw mapSqliteError(error) }
  }

  async listColumns(database: string, table: string): Promise<DatabaseColumn[]> {
    const databaseName = validateIdentifier(database, 'database')
    const tableName = validateIdentifier(table, 'table')
    try {
      const rows = this.client.prepare(`PRAGMA ${quoteIdentifier(databaseName)}.table_info(${quoteIdentifier(tableName)})`).all() as {
        cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number
      }[]
      return rows.map((row) => ({
        database: databaseName,
        table: tableName,
        name: row.name,
        ordinal: row.cid + 1,
        dataType: row.type || 'ANY',
        columnType: row.type || 'ANY',
        nullable: !row.notnull,
        key: row.pk ? 'PRI' : undefined,
        defaultValue: serializeDatabaseValue(row.dflt_value),
        length: Number(row.type.match(/\((\d+)/)?.[1]) || undefined
      }))
    } catch (error) { throw mapSqliteError(error) }
  }

  async query(input: DatabaseQueryRequest): Promise<DatabaseQueryResult> {
    const request = normalizeQueryRequest(input)
    const startedAt = Date.now()
    const statementName = databaseStatement(request.sql)
    try {
      const sourceSql = stripFinalSemicolon(request.sql)
      const sourceStatement = this.client.prepare(sourceSql)
      const pageable = sourceStatement.reader && isPageableStatement(request.sql)
      const statement = pageable ? this.client.prepare(buildPagedMysqlQuery(request.sql, request.page, request.pageSize)) : sourceStatement
      if (!statement.reader) {
        const mutation = statement.run()
        return {
          kind: 'mutation', columns: [], rows: [], page: 0, pageSize: request.pageSize, hasMore: false,
          affectedRows: mutation.changes, changedRows: mutation.changes,
          insertId: statementName === 'INSERT' || statementName === 'REPLACE' ? String(mutation.lastInsertRowid) : undefined,
          warningStatus: 0, durationMs: Date.now() - startedAt, statement: statementName
        }
      }
      const columns: DatabaseResultColumn[] = statement.columns().map((column) => ({ name: column.name, table: column.table || undefined, type: column.type || undefined }))
      const allRows = statement.raw(true).all() as unknown[][]
      const hasMore = pageable && allRows.length > request.pageSize
      const rows = (hasMore ? allRows.slice(0, request.pageSize) : allRows).map((row) => row.map(serializeDatabaseValue))
      return {
        kind: 'rows', columns, rows, page: pageable ? request.page : 0, pageSize: request.pageSize, hasMore,
        affectedRows: 0, changedRows: 0, warningStatus: 0, durationMs: Date.now() - startedAt, statement: statementName
      }
    } catch (error) { throw mapSqliteError(error) }
  }

  close(): void {
    this.client.close()
  }
}

export function mapSqliteError(error: unknown): Error & { code: string } {
  const source = error as { code?: string; message?: string }
  const code = source?.code || ''
  if (code.startsWith('DATABASE_') && error instanceof Error) return error as Error & { code: string }
  const mapped = code === 'SQLITE_CANTOPEN' ? 'DATABASE_FILE_NOT_FOUND'
    : code === 'SQLITE_READONLY' || code === 'SQLITE_READONLY_DBMOVED' ? 'DATABASE_READ_ONLY'
      : code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' ? 'DATABASE_FILE_INVALID'
        : code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' ? 'DATABASE_BUSY'
          : code === 'SQLITE_ERROR' ? 'DATABASE_SQL_INVALID'
            : 'DATABASE_QUERY_FAILED'
  return sqliteError(mapped, source?.message || 'SQLite operation failed')
}

function validateIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 200 || /[\0\r\n]/.test(value)) throw sqliteError('DATABASE_IDENTIFIER_INVALID', `Invalid ${label} name`)
  return value
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function stripFinalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}

function sqliteError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
