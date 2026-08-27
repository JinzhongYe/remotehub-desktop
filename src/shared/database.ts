export type DatabaseAdapterType = 'mysql' | 'postgres'
export type DatabaseObjectType = 'table' | 'view'
export type DatabaseCell = string | number | boolean | null

export interface DatabaseConnectResult {
  sessionId: string
  adapter: DatabaseAdapterType
  database?: string
  serverVersion: string
}

export interface DatabaseCatalog {
  name: string
  system: boolean
}

export interface DatabaseTable {
  database: string
  name: string
  type: DatabaseObjectType
  estimatedRows?: number
}

export interface DatabaseColumn {
  database: string
  table: string
  name: string
  ordinal: number
  dataType: string
  columnType: string
  nullable: boolean
  key?: string
  defaultValue?: DatabaseCell
  extra?: string
}

export interface DatabaseResultColumn {
  name: string
  table?: string
  type?: string
}

export interface DatabaseQueryRequest {
  sql: string
  page?: number
  pageSize?: number
}

export interface DatabaseQueryResult {
  kind: 'rows' | 'mutation'
  columns: DatabaseResultColumn[]
  rows: DatabaseCell[][]
  page: number
  pageSize: number
  hasMore: boolean
  affectedRows: number
  changedRows: number
  insertId?: string
  warningStatus: number
  durationMs: number
  statement: string
}

export const DATABASE_PAGE_SIZE = 200
export const DATABASE_MAX_PAGE_SIZE = 500
export const DATABASE_MAX_SQL_LENGTH = 1024 * 1024

export function normalizeQueryRequest(request: DatabaseQueryRequest): Required<DatabaseQueryRequest> {
  if (!request || typeof request !== 'object') throw databaseInputError('DATABASE_QUERY_INVALID', 'Query request is invalid')
  const sql = String(request.sql || '').trim()
  if (!sql || sql.length > DATABASE_MAX_SQL_LENGTH) throw databaseInputError('DATABASE_QUERY_INVALID', 'SQL must contain between 1 byte and 1 MB')
  const page = Number(request.page ?? 0)
  const pageSize = Number(request.pageSize ?? DATABASE_PAGE_SIZE)
  if (!Number.isInteger(page) || page < 0 || page > 1_000_000) throw databaseInputError('DATABASE_PAGE_INVALID', 'Query page is invalid')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > DATABASE_MAX_PAGE_SIZE) throw databaseInputError('DATABASE_PAGE_INVALID', `Page size must be between 1 and ${DATABASE_MAX_PAGE_SIZE}`)
  return { sql, page, pageSize }
}

export function databaseStatement(sql: string): string {
  const withoutLeadingComments = sql
    .replace(/^\uFEFF/, '')
    .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|#[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/, '')
  return withoutLeadingComments.match(/^([a-z]+)/i)?.[1]?.toUpperCase() || 'UNKNOWN'
}

export function isPageableStatement(sql: string): boolean {
  const statement = databaseStatement(sql)
  return statement === 'SELECT' || statement === 'WITH'
}

function databaseInputError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
