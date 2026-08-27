import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'
import { Client, type FieldDef, type QueryArrayResult } from 'pg'
import type { DatabaseCatalog, DatabaseColumn, DatabaseQueryRequest, DatabaseQueryResult, DatabaseResultColumn, DatabaseTable } from '../../../shared/database'
import { databaseStatement, isPageableStatement, normalizeQueryRequest } from '../../../shared/database'
import type { DatabaseSslMode } from '../../../shared/types'
import { fingerprintHostKey } from '../host-key'
import type { DatabaseAdapter, DatabaseAdapterFactory, DatabaseTunnel } from './adapter'
import { serializeDatabaseValue } from './mysql'

const QUERY_TIMEOUT_MS = 30_000
const CURSOR_NAME = '__remotehub_page'
const SYSTEM_SCHEMAS = new Set(['information_schema', 'pg_catalog', 'pg_toast'])
const loadNativeModule = createRequire(__filename)

type TunnelClient = {
  on(event: string, listener: (...args: unknown[]) => void): TunnelClient
  connect(config: Record<string, unknown>): void
  forwardOut(sourceHost: string, sourcePort: number, host: string, port: number, callback: (error: Error | undefined, stream: Duplex) => void): void
  end(): void
}

type TunnelHandle = { stream: Duplex; close(): void }

export const postgresAdapterFactory: DatabaseAdapterFactory = {
  async connect(connection, password, tunnel) {
    if (connection.type !== 'database' || connection.databaseType !== 'postgres') throw databaseError('DATABASE_ADAPTER_UNAVAILABLE', 'PostgreSQL connection is required')
    if (!connection.username) throw databaseError('DATABASE_USERNAME_REQUIRED', 'PostgreSQL username is required')
    let tunnelHandle: TunnelHandle | undefined
    try {
      tunnelHandle = tunnel ? await openSshTunnel(tunnel, connection.host, connection.port) : undefined
      const client = new Client({
        host: connection.host,
        port: connection.port,
        user: connection.username,
        password: password || '',
        database: connection.database || connection.username,
        ssl: postgresSsl(connection.databaseSslMode),
        stream: tunnelHandle ? () => tunnelHandle!.stream : undefined,
        application_name: 'RemoteHub',
        connectionTimeoutMillis: 10_000,
        statement_timeout: QUERY_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
        keepAlive: true
      })
      client.on('error', () => { /* queries surface errors; prevent idle client errors from becoming uncaught */ })
      await client.connect()
      const info = await client.query<{ version: string; schema: string }>('SELECT version(), current_schema() AS schema')
      return new PostgresAdapter(client, info.rows[0]?.schema || 'public', info.rows[0]?.version || 'PostgreSQL', tunnelHandle)
    } catch (error) {
      tunnelHandle?.close()
      throw mapPostgresError(error)
    }
  }
}

export class PostgresAdapter implements DatabaseAdapter {
  readonly type = 'postgres' as const
  private cursorSql = ''
  private cursorOpen = false

  constructor(private readonly client: Client, public database: string, public readonly serverVersion: string, private readonly tunnel?: TunnelHandle) {}

  async ping(): Promise<void> {
    try { await this.client.query('SELECT 1') } catch (error) { throw mapPostgresError(error) }
  }

  async listDatabases(): Promise<DatabaseCatalog[]> {
    try {
      const result = await this.client.query<{ name: string }>(`SELECT schema_name AS name FROM information_schema.schemata
        WHERE schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast_temp_%' ORDER BY schema_name`)
      return result.rows.map(({ name }) => ({ name, system: SYSTEM_SCHEMAS.has(name) || name.startsWith('pg_') }))
    } catch (error) { throw mapPostgresError(error) }
  }

  async useDatabase(schema: string): Promise<void> {
    const name = validateIdentifier(schema, 'schema')
    try {
      await this.closeCursor()
      await this.client.query("SELECT set_config('search_path', quote_ident($1), false)", [name])
      this.database = name
    } catch (error) { throw mapPostgresError(error) }
  }

  async listTables(schema: string): Promise<DatabaseTable[]> {
    const name = validateIdentifier(schema, 'schema')
    try {
      const result = await this.client.query<{ name: string; kind: string; rows: string }>(`SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint::text AS rows
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY c.relkind, c.relname`, [name])
      return result.rows.map((row) => ({
        database: name,
        name: row.name,
        type: row.kind === 'v' || row.kind === 'm' ? 'view' : 'table',
        estimatedRows: Number.isFinite(Number(row.rows)) ? Number(row.rows) : undefined
      }))
    } catch (error) { throw mapPostgresError(error) }
  }

  async listColumns(schema: string, table: string): Promise<DatabaseColumn[]> {
    const schemaName = validateIdentifier(schema, 'schema')
    const tableName = validateIdentifier(table, 'table')
    try {
      const result = await this.client.query<{
        name: string; ordinal: number; data_type: string; column_type: string; nullable: string; default_value: string | null; primary_key: boolean
      }>(`SELECT c.column_name AS name, c.ordinal_position AS ordinal, c.data_type,
          COALESCE(c.domain_name, c.udt_name) AS column_type, c.is_nullable AS nullable,
          c.column_default AS default_value,
          EXISTS (SELECT 1 FROM pg_catalog.pg_class t
            JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_catalog.pg_index i ON i.indrelid = t.oid AND i.indisprimary
            WHERE n.nspname = c.table_schema AND t.relname = c.table_name AND c.ordinal_position = ANY(i.indkey)) AS primary_key
        FROM information_schema.columns c WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position`, [schemaName, tableName])
      return result.rows.map((row) => ({
        database: schemaName,
        table: tableName,
        name: row.name,
        ordinal: Number(row.ordinal),
        dataType: row.data_type,
        columnType: row.column_type,
        nullable: row.nullable === 'YES',
        key: row.primary_key ? 'PRI' : undefined,
        defaultValue: row.default_value,
        extra: row.default_value?.startsWith('nextval(') ? 'auto increment' : undefined
      }))
    } catch (error) { throw mapPostgresError(error) }
  }

  async query(input: DatabaseQueryRequest): Promise<DatabaseQueryResult> {
    const request = normalizeQueryRequest(input)
    const startedAt = Date.now()
    const statement = databaseStatement(request.sql)
    try {
      if (isPageableStatement(request.sql)) {
        const source = stripFinalSemicolon(request.sql)
        if (!this.cursorOpen || this.cursorSql !== source) await this.openCursor(source)
        const commands = buildPostgresCursorCommands(request.page, request.pageSize)
        await this.client.query(commands.move)
        const result = await this.client.query({ text: commands.fetch, rowMode: 'array' }) as QueryArrayResult<unknown[]>
        const hasMore = result.rows.length > request.pageSize
        return rowResult(result, hasMore ? result.rows.slice(0, request.pageSize) : result.rows, request.page, request.pageSize, hasMore, statement, startedAt)
      }

      await this.closeCursor()
      const result = await this.client.query({ text: stripFinalSemicolon(request.sql), rowMode: 'array' }) as QueryArrayResult<unknown[]> | QueryArrayResult<unknown[]>[]
      const last = Array.isArray(result) ? result.at(-1)! : result
      if (last.fields.length) return rowResult(last, last.rows, 0, request.pageSize, false, statement, startedAt)
      return {
        kind: 'mutation', columns: [], rows: [], page: 0, pageSize: request.pageSize, hasMore: false,
        affectedRows: last.rowCount || 0, changedRows: last.rowCount || 0, warningStatus: 0,
        durationMs: Date.now() - startedAt, statement
      }
    } catch (error) {
      if (this.cursorOpen) {
        this.cursorOpen = false
        this.cursorSql = ''
        await this.client.query('ROLLBACK').catch(() => undefined)
      }
      throw mapPostgresError(error)
    }
  }

  close(): void {
    void this.closeCursor().finally(() => this.client.end()).finally(() => this.tunnel?.close())
  }

  private async openCursor(sql: string): Promise<void> {
    await this.closeCursor()
    await this.client.query('BEGIN READ ONLY')
    try {
      await this.client.query(`DECLARE "${CURSOR_NAME}" SCROLL CURSOR FOR ${sql}`)
      this.cursorSql = sql
      this.cursorOpen = true
    } catch (error) {
      await this.client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  private async closeCursor(): Promise<void> {
    if (!this.cursorOpen) return
    this.cursorOpen = false
    this.cursorSql = ''
    try {
      await this.client.query(`CLOSE "${CURSOR_NAME}"`)
      await this.client.query('COMMIT')
    } catch {
      await this.client.query('ROLLBACK').catch(() => undefined)
    }
  }
}

export function buildPostgresCursorCommands(page: number, pageSize: number): { move: string; fetch: string } {
  const offset = page * pageSize
  return {
    move: `MOVE ABSOLUTE ${offset} IN "${CURSOR_NAME}"`,
    fetch: `FETCH FORWARD ${pageSize + 1} FROM "${CURSOR_NAME}"`
  }
}

export function postgresSsl(mode?: DatabaseSslMode): false | { rejectUnauthorized: boolean } {
  return mode === 'require' ? { rejectUnauthorized: false } : mode === 'verify-full' ? { rejectUnauthorized: true } : false
}

function rowResult(result: QueryArrayResult<unknown[]>, sourceRows: unknown[][], page: number, pageSize: number, hasMore: boolean, statement: string, startedAt: number): DatabaseQueryResult {
  return {
    kind: 'rows',
    columns: serializeFields(result.fields),
    rows: sourceRows.map((row) => row.map(serializeDatabaseValue)),
    page,
    pageSize,
    hasMore,
    affectedRows: 0,
    changedRows: 0,
    warningStatus: 0,
    durationMs: Date.now() - startedAt,
    statement
  }
}

function serializeFields(fields: FieldDef[]): DatabaseResultColumn[] {
  return fields.map((field) => ({ name: field.name, table: field.tableID ? String(field.tableID) : undefined, type: String(field.dataTypeID) }))
}

async function openSshTunnel(tunnel: DatabaseTunnel, host: string, port: number): Promise<TunnelHandle> {
  const connection = tunnel.connection
  if (connection.type !== 'ssh' || !connection.username || !tunnel.credential) throw databaseError('DATABASE_TUNNEL_INVALID', 'SSH tunnel connection or credential is missing')
  if (!connection.hostKeyFingerprint) throw databaseError('DATABASE_TUNNEL_HOST_KEY_REQUIRED', 'Open the SSH connection once to verify and trust its host key before using it as a tunnel')
  const module = loadNativeModule('ssh2') as { Client?: new () => TunnelClient }
  if (!module.Client) throw databaseError('DATABASE_TUNNEL_UNAVAILABLE', 'SSH module is unavailable')
  const client = new module.Client()
  return new Promise((resolve, reject) => {
    let settled = false
    let receivedFingerprint = ''
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      client.end()
      reject(receivedFingerprint && receivedFingerprint !== connection.hostKeyFingerprint
        ? databaseError('DATABASE_TUNNEL_HOST_KEY_CHANGED', `SSH tunnel host key changed. Expected ${connection.hostKeyFingerprint}, received ${receivedFingerprint}.`)
        : error)
    }
    client.on('ready', () => client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => {
      if (error) return fail(error)
      settled = true
      resolve({ stream, close: () => { stream.destroy(); client.end() } })
    }))
    client.on('error', fail)
    try {
      client.connect({
        host: connection.host,
        port: connection.port,
        username: connection.username,
        readyTimeout: 10_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer) => {
          receivedFingerprint = fingerprintHostKey(key)
          return receivedFingerprint === connection.hostKeyFingerprint
        },
        ...(connection.authType === 'privateKey' ? { privateKey: tunnel.credential } : { password: tunnel.credential })
      })
    } catch (error) { fail(error) }
  })
}

function validateIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 200 || /[\0\r\n]/.test(value)) throw databaseError('DATABASE_IDENTIFIER_INVALID', `Invalid ${label} name`)
  return value
}

function stripFinalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}

export function mapPostgresError(error: unknown): Error & { code: string } {
  const source = error as { code?: string; message?: string }
  const code = source?.code || ''
  if (code.startsWith('DATABASE_') && error instanceof Error) return error as Error & { code: string }
  const mapped = code === '28P01' || code === '28000' ? 'DATABASE_AUTH_FAILED'
    : code === '3D000' ? 'DATABASE_NOT_FOUND'
      : code === '42601' ? 'DATABASE_SQL_INVALID'
        : code === '42P01' ? 'DATABASE_TABLE_NOT_FOUND'
          : code === 'ECONNREFUSED' ? 'DATABASE_CONNECTION_REFUSED'
            : code === 'ETIMEDOUT' ? 'DATABASE_TIMEOUT'
              : code === 'ENOTFOUND' ? 'DATABASE_HOST_NOT_FOUND'
                : code === '57P01' || code === 'ECONNRESET' ? 'DATABASE_CONNECTION_LOST'
                  : 'DATABASE_QUERY_FAILED'
  return databaseError(mapped, source?.message || 'PostgreSQL operation failed')
}

function databaseError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
