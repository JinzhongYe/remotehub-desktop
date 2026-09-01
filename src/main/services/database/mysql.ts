import { createConnection, type Connection as MysqlConnection, type FieldPacket, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import type { DatabaseCatalog, DatabaseCell, DatabaseColumn, DatabaseQueryRequest, DatabaseQueryResult, DatabaseResultColumn, DatabaseTable } from '../../../shared/database'
import { databaseStatement, isPageableStatement, normalizeQueryRequest } from '../../../shared/database'
import type { DatabaseAdapter, DatabaseAdapterFactory } from './adapter'

const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])
const QUERY_TIMEOUT_MS = 30_000

export const mysqlAdapterFactory: DatabaseAdapterFactory = {
  async connect(connection, password) {
    if (connection.type !== 'database' || connection.databaseType !== 'mysql') throw databaseError('DATABASE_ADAPTER_UNAVAILABLE', 'Phase 6 supports MySQL connections only')
    if (!connection.username) throw databaseError('DATABASE_USERNAME_REQUIRED', 'MySQL username is required')
    try {
      const client = await createConnection({
        host: connection.host,
        port: connection.port,
        user: connection.username,
        password: password || '',
        database: connection.database,
        charset: 'utf8mb4',
        connectTimeout: 10_000,
        dateStrings: true,
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
        rowsAsArray: true
      })
      const [versionRows] = await client.query({ sql: 'SELECT VERSION()', rowsAsArray: true, timeout: QUERY_TIMEOUT_MS })
      const version = Array.isArray(versionRows) && Array.isArray(versionRows[0]) ? String(versionRows[0][0] || 'MySQL') : 'MySQL'
      return new MysqlAdapter(client, connection.database, version)
    } catch (error) {
      throw mapMysqlError(error)
    }
  }
}

export class MysqlAdapter implements DatabaseAdapter {
  readonly type = 'mysql' as const

  constructor(private readonly client: MysqlConnection, public database: string | undefined, public readonly serverVersion: string) {}

  async ping(): Promise<void> {
    try { await this.client.ping() } catch (error) { throw mapMysqlError(error) }
  }

  async listDatabases(): Promise<DatabaseCatalog[]> {
    try {
      const [rows] = await this.client.query({ sql: 'SHOW DATABASES', rowsAsArray: true, timeout: QUERY_TIMEOUT_MS })
      return asRows(rows).map((row) => String(row[0])).filter(Boolean).map((name) => ({ name, system: SYSTEM_DATABASES.has(name.toLocaleLowerCase()) }))
    } catch (error) { throw mapMysqlError(error) }
  }

  async useDatabase(database: string): Promise<void> {
    const name = validateIdentifier(database, 'database')
    try {
      await this.client.changeUser({ database: name })
      this.database = name
    } catch (error) { throw mapMysqlError(error) }
  }

  async listTables(database: string): Promise<DatabaseTable[]> {
    const name = validateIdentifier(database, 'database')
    try {
      const [rows] = await this.client.execute<RowDataPacket[][]>({
        sql: `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS
              FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ?
              ORDER BY TABLE_TYPE, TABLE_NAME`,
        rowsAsArray: true,
        timeout: QUERY_TIMEOUT_MS
      }, [name])
      return asRows(rows).map((row) => ({
        database: name,
        name: String(row[0]),
        type: String(row[1]).toUpperCase() === 'VIEW' ? 'view' : 'table',
        estimatedRows: row[2] == null ? undefined : safeNumber(row[2])
      }))
    } catch (error) { throw mapMysqlError(error) }
  }

  async listColumns(database: string, table: string): Promise<DatabaseColumn[]> {
    const databaseName = validateIdentifier(database, 'database')
    const tableName = validateIdentifier(table, 'table')
    try {
      const [rows] = await this.client.execute<RowDataPacket[][]>({
        sql: `SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
                     COLUMN_KEY, COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_SCALE, COLUMN_COMMENT
              FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY ORDINAL_POSITION`,
        rowsAsArray: true,
        timeout: QUERY_TIMEOUT_MS
      }, [databaseName, tableName])
      return asRows(rows).map((row) => ({
        database: databaseName,
        table: tableName,
        name: String(row[0]),
        ordinal: safeNumber(row[1]),
        dataType: String(row[2]),
        columnType: String(row[3]),
        nullable: String(row[4]).toUpperCase() === 'YES',
        key: row[5] ? String(row[5]) : undefined,
        defaultValue: row[6] == null ? null : serializeDatabaseValue(row[6]),
        extra: row[7] ? String(row[7]) : undefined,
        length: row[8] == null ? undefined : safeNumber(row[8]),
        scale: row[9] == null ? undefined : safeNumber(row[9]),
        comment: row[10] ? String(row[10]) : undefined
      }))
    } catch (error) { throw mapMysqlError(error) }
  }

  async query(input: DatabaseQueryRequest): Promise<DatabaseQueryResult> {
    const request = normalizeQueryRequest(input)
    const startedAt = Date.now()
    const statement = databaseStatement(request.sql)
    const pageable = isPageableStatement(request.sql)
    const sql = pageable ? buildPagedMysqlQuery(request.sql, request.page, request.pageSize) : stripFinalSemicolon(request.sql)
    try {
      const [result, fields] = await this.client.query({ sql, rowsAsArray: true, timeout: QUERY_TIMEOUT_MS })
      if (Array.isArray(result)) {
        const allRows = asRows(result)
        const hasMore = pageable && allRows.length > request.pageSize
        const rows = (hasMore ? allRows.slice(0, request.pageSize) : allRows).map((row) => row.map(serializeDatabaseValue))
        return {
          kind: 'rows',
          columns: serializeFields(fields),
          rows,
          page: pageable ? request.page : 0,
          pageSize: request.pageSize,
          hasMore,
          affectedRows: 0,
          changedRows: 0,
          warningStatus: 0,
          durationMs: Date.now() - startedAt,
          statement
        }
      }
      const header = result as ResultSetHeader
      return {
        kind: 'mutation',
        columns: [],
        rows: [],
        page: 0,
        pageSize: request.pageSize,
        hasMore: false,
        affectedRows: safeNumber(header.affectedRows),
        changedRows: safeNumber(header.changedRows),
        insertId: header.insertId == null ? undefined : String(header.insertId),
        warningStatus: safeNumber(header.warningStatus),
        durationMs: Date.now() - startedAt,
        statement
      }
    } catch (error) { throw mapMysqlError(error) }
  }

  close(): void {
    this.client.destroy()
  }
}

export function buildPagedMysqlQuery(sql: string, page: number, pageSize: number): string {
  const source = stripFinalSemicolon(sql)
  const offset = page * pageSize
  return hasTopLevelLimit(source)
    ? `SELECT * FROM (${source}) AS \`__remotehub_page\` LIMIT ${pageSize + 1} OFFSET ${offset}`
    : `${source} LIMIT ${pageSize + 1} OFFSET ${offset}`
}

export function serializeDatabaseValue(value: unknown): DatabaseCell {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes: ${value.subarray(0, 24).toString('hex')}${value.length > 24 ? '…' : ''}>`
  if (value instanceof Date) return value.toISOString()
  try { return JSON.stringify(value) } catch { return String(value) }
}

function serializeFields(fields: FieldPacket[] | undefined): DatabaseResultColumn[] {
  return (fields || []).map((field) => ({ name: field.name, table: field.table || undefined, type: String(field.type) }))
}

function asRows(value: unknown): unknown[][] {
  if (!Array.isArray(value)) return []
  return value.map((row) => Array.isArray(row) ? row : Object.values(row as Record<string, unknown>))
}

function stripFinalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}

function hasTopLevelLimit(sql: string): boolean {
  let depth = 0
  let quote = ''
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]
    const next = sql[index + 1]
    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index++ }
      continue
    }
    if (quote) {
      if (char === '\\') { index++; continue }
      if (char === quote) {
        if (next === quote) index++
        else quote = ''
      }
      continue
    }
    if (char === '-' && next === '-' && /\s/.test(sql[index + 2] || '')) { lineComment = true; index++; continue }
    if (char === '#') { lineComment = true; continue }
    if (char === '/' && next === '*') { blockComment = true; index++; continue }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === '(') { depth++; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); continue }
    if (depth === 0 && /[a-z_]/i.test(char)) {
      const match = sql.slice(index).match(/^[a-z_]+/i)
      const word = match?.[0] || ''
      if (word.toUpperCase() === 'LIMIT') return true
      index += Math.max(0, word.length - 1)
    }
  }
  return false
}

function validateIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 200 || /[\0\r\n]/.test(value)) throw databaseError('DATABASE_IDENTIFIER_INVALID', `Invalid ${label} name`)
  return value
}

function safeNumber(value: unknown): number {
  const result = Number(value || 0)
  return Number.isFinite(result) ? result : 0
}

export function mapMysqlError(error: unknown): Error & { code: string } {
  const source = error as { code?: string; errno?: number; message?: string }
  const code = source?.code || ''
  if (code.startsWith('DATABASE_') && error instanceof Error) return error as Error & { code: string }
  const mapped = code === 'ER_ACCESS_DENIED_ERROR' ? 'DATABASE_AUTH_FAILED'
    : code === 'ER_BAD_DB_ERROR' ? 'DATABASE_NOT_FOUND'
      : code === 'ER_PARSE_ERROR' ? 'DATABASE_SQL_INVALID'
        : code === 'ER_NO_SUCH_TABLE' ? 'DATABASE_TABLE_NOT_FOUND'
          : code === 'ECONNREFUSED' ? 'DATABASE_CONNECTION_REFUSED'
            : code === 'ETIMEDOUT' || code === 'PROTOCOL_SEQUENCE_TIMEOUT' ? 'DATABASE_TIMEOUT'
              : code === 'ENOTFOUND' ? 'DATABASE_HOST_NOT_FOUND'
                : code === 'PROTOCOL_CONNECTION_LOST' ? 'DATABASE_CONNECTION_LOST'
                  : 'DATABASE_QUERY_FAILED'
  return databaseError(mapped, source?.message || 'MySQL operation failed')
}

function databaseError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
