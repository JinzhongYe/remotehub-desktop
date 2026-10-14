import queries from './database-schema-queries.json'
import type { DatabaseAdapterType, DatabaseSchemaSection } from './database'

// The Electron and Rust backends use the same read-only catalog queries.
// ponytail: SQLite CHECKs stay in CREATE TABLE SQL; parse them only for per-constraint editing.
// References: https://www.sqlite.org/pragma.html
// https://www.postgresql.org/docs/14/catalogs.html
// https://dev.mysql.com/doc/refman/8.0/en/information-schema.html
export function databaseSchemaQuery(adapter: DatabaseAdapterType, database: string, table: string, section: DatabaseSchemaSection): { sql: string; values: string[]; columns: string[]; notice?: string } {
  for (const name of [database, table]) {
    if (typeof name !== 'string' || !name || name.length > 200 || /[\0\r\n]/.test(name)) throw Object.assign(new Error('Invalid database or table name'), { code: 'DATABASE_IDENTIFIER_INVALID' })
  }
  const sections = queries[adapter]
  if (!sections || !Object.hasOwn(sections, section)) throw Object.assign(new Error('Invalid schema section'), { code: 'DATABASE_SCHEMA_SECTION_INVALID' })
  const query: { sql: string; columns: string[]; parameters?: boolean; notice?: string } = sections[section]
  const quote = (name: string) => adapter === 'mysql' ? `\`${name.replaceAll('`', '``')}\`` : `"${name.replaceAll('"', '""')}"`
  return {
    sql: query.sql.replace(/\{\{(database|table)\}\}/g, (_match, name: string) => quote(name === 'database' ? database : table)),
    values: query.parameters === false ? [] : [database, table],
    columns: query.columns,
    notice: query.notice
  }
}
