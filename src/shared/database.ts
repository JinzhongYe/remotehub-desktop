export type DatabaseAdapterType = 'mysql' | 'postgres' | 'sqlite'
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

export interface DatabaseCsvExport {
  fileName: string
  columns: string[]
  rows: DatabaseCell[][]
}

export const DATABASE_PAGE_SIZE = 200
export const DATABASE_MAX_PAGE_SIZE = 500
export const DATABASE_MAX_SQL_LENGTH = 1024 * 1024

export function databaseDisplayRows(rows: DatabaseCell[][], filter = '', sortColumn = -1, direction: 'asc' | 'desc' = 'asc'): DatabaseCell[][] {
  const needle = filter.trim().toLocaleLowerCase()
  const visible = needle ? rows.filter((row) => row.some((cell) => (cell == null ? 'null' : String(cell)).toLocaleLowerCase().includes(needle))) : [...rows]
  if (sortColumn < 0) return visible
  return visible.sort((left, right) => {
    const a = left[sortColumn]
    const b = right[sortColumn]
    const compared = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : a == null ? 1 : b == null ? -1 : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
    return direction === 'asc' ? compared : -compared
  })
}

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

export function databaseResultToCsv(input: DatabaseCsvExport): string {
  if (!input || !Array.isArray(input.columns) || !Array.isArray(input.rows) || input.columns.length > 1000 || input.rows.length > DATABASE_MAX_PAGE_SIZE) {
    throw databaseInputError('DATABASE_EXPORT_INVALID', 'Export data is invalid')
  }
  const width = input.columns.length
  if (!width || input.rows.some((row) => !Array.isArray(row) || row.length !== width)) throw databaseInputError('DATABASE_EXPORT_INVALID', 'Export rows do not match the columns')
  return [input.columns, ...input.rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function csvCell(value: DatabaseCell): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function databaseInputError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
