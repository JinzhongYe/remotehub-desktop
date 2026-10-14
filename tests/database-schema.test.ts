import { describe, expect, it, vi } from 'vitest'
import { databaseSchemaQuery } from '../src/shared/database-schema'
import { MysqlAdapter } from '../src/main/services/database/mysql'
import { PostgresAdapter } from '../src/main/services/database/postgres'
import { SqliteAdapter } from '../src/main/services/database/sqlite'
import type { DatabaseSchemaSection } from '../src/shared/database'

const sections: DatabaseSchemaSection[] = ['indexes', 'foreignKeys', 'checks', 'triggers', 'advanced']

describe('Read-only table details', () => {
  it('binds catalog names and rejects invalid sections and identifiers', () => {
    for (const adapter of ['mysql', 'postgres', 'sqlite'] as const) {
      for (const section of sections) {
        const query = databaseSchemaQuery(adapter, 'app', "a'b", section)
        expect(query.columns.length).toBeGreaterThan(0)
        expect(query.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|COMMIT|ROLLBACK)\b/)
        if (section !== 'advanced' || adapter !== 'mysql') {
          expect(query.values).toEqual(['app', "a'b"])
          expect(query.sql).not.toContain("a'b")
        }
      }
      expect(() => databaseSchemaQuery(adapter, 'app', 'cells', 'constructor' as never)).toThrow('Invalid schema section')
      expect(() => databaseSchemaQuery(adapter, '', 'cells', 'indexes')).toThrow('Invalid database or table name')
      expect(() => databaseSchemaQuery(adapter, 'app', 'cells\0', 'indexes')).toThrow('Invalid database or table name')
    }
  })

  it('quotes identifiers once without treating their contents as template placeholders', () => {
    expect(databaseSchemaQuery('mysql', 'a`{{table}}$&', 'b`c', 'advanced')).toMatchObject({
      sql: 'SHOW CREATE TABLE `a``{{table}}$&`.`b``c`', values: []
    })
    expect(databaseSchemaQuery('sqlite', 'a"{{table}}$&', 'cells', 'advanced').sql).toContain('"a""{{table}}$&".sqlite_schema')
  })

  it('runs MySQL metadata separately from pageable editor queries and serializes rows', async () => {
    const execute = vi.fn(async () => [[["name", 9007199254740993n]], []])
    const client = { on: vi.fn(), execute, query: vi.fn() }
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    await expect(adapter.listTableDetails('app', 'cells', 'checks')).resolves.toMatchObject({ columns: ['name', 'definition', 'enforced'], rows: [['name', '9007199254740993']], hasMore: false })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ rowsAsArray: true, sql: expect.stringContaining("t.CONSTRAINT_TYPE = 'CHECK'") }), ['app', 'cells'])
    expect(client.query).not.toHaveBeenCalled()
  })

  it('preserves the PostgreSQL pagination cursor and never commits a manual transaction', async () => {
    const commands: unknown[] = []
    const client = { on: vi.fn(), query: vi.fn(async (request: unknown) => {
      commands.push(request)
      return { command: 'SELECT', fields: [{ name: 'name' }], rows: [['idx']] }
    }) }
    const adapter = new PostgresAdapter(client as never, 'app', '14')
    await adapter.query({ sql: 'SELECT * FROM cells' })
    commands.length = 0
    await expect(adapter.listTableDetails('other_schema', 'cells', 'indexes')).resolves.toMatchObject({ rows: [['idx']] })
    expect(commands).toEqual([expect.objectContaining({ rowMode: 'array', values: ['other_schema', 'cells'], text: expect.stringContaining('pg_get_indexdef') })])
    commands.length = 0
    await adapter.query({ sql: 'SELECT * FROM cells', page: 1 })
    expect(commands).toEqual(['MOVE ABSOLUTE 200 IN "__remotehub_page"', expect.objectContaining({ text: 'FETCH FORWARD 201 FROM "__remotehub_page"' })])
    await adapter.query({ sql: 'BEGIN' })
    commands.length = 0
    await adapter.listTableDetails('public', 'cells', 'checks')
    expect(commands).toEqual([expect.objectContaining({ values: ['public', 'cells'], text: expect.stringContaining("c.contype = 'c'") })])
  })

  it('caps metadata rows and retains the SQLite CHECK definition notice', async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => [`cells_${index}`, 'CREATE TABLE cells (id CHECK (id > 0))'])
    const all = vi.fn(() => rows)
    const client = { prepare: vi.fn(() => ({ raw: () => ({ all }) })) }
    const adapter = new SqliteAdapter(client as never, 'SQLite')
    const details = await adapter.listTableDetails('attached', 'cells', 'checks')
    expect(details.rows).toHaveLength(5000)
    expect(details.hasMore).toBe(true)
    expect(details.notice).toBe('sqliteCheckDefinitions')
    expect(all).toHaveBeenCalledWith('attached', 'cells')
    expect(client.prepare).toHaveBeenCalledWith(expect.stringContaining('"attached".sqlite_schema'))
  })

  it('propagates metadata failures instead of returning an empty schema', async () => {
    const client = { on: vi.fn(), execute: vi.fn(async () => { throw Object.assign(new Error('No CHECK_CONSTRAINTS table'), { code: 'ER_NO_SUCH_TABLE' }) }) }
    await expect(new MysqlAdapter(client as never, 'app', '5.7').listTableDetails('app', 'cells', 'checks')).rejects.toThrow('No CHECK_CONSTRAINTS table')
  })
})
