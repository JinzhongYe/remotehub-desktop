import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { normalizeChangesRequest } from '../src/shared/database'
import { MysqlAdapter } from '../src/main/services/database/mysql'
import { PostgresAdapter } from '../src/main/services/database/postgres'
import { DatabaseService } from '../src/main/services/database'

const request = { database: 'app', table: 'cells', statements: ['INSERT INTO cells VALUES (1)', 'UPDATE cells SET id = 2'] }

function mysqlClient(failSql = '') {
  return Object.assign(new EventEmitter(), {
    query: vi.fn(async () => [{}, []]),
    execute: vi.fn(async ({ sql }: { sql: string }) => {
      if (sql.includes('information_schema.ENGINES')) return [[['YES']], []]
      if (sql === failSql) throw new Error('Write failed')
      return [{ affectedRows: 1 }, []]
    }),
    destroy: vi.fn()
  })
}

describe('atomic table changes', () => {
  it('rejects invalid, non-DML and oversized requests before opening a transaction', () => {
    expect(normalizeChangesRequest(request)).toEqual(request)
    for (const statements of [[], ['COMMIT'], ['CREATE TABLE cells (id int)'], [`INSERT INTO cells VALUES ('${'中'.repeat(400_000)}')`]]) {
      expect(() => normalizeChangesRequest({ ...request, statements })).toThrow()
    }
    expect(() => normalizeChangesRequest({ ...request, table: '\0' })).toThrow()
  })

  it('commits all MySQL changes and rolls back when a later write fails', async () => {
    for (const fails of [false, true]) {
      const client = mysqlClient(fails ? request.statements[1] : '')
      const saving = new MysqlAdapter(client as never, 'app', '8.4').applyChanges(request)
      if (fails) await expect(saving).rejects.toThrow('Write failed')
      else await saving
      expect(client.query.mock.calls.map((args) => (args[0] as { sql: string }).sql)).toEqual(['START TRANSACTION', fails ? 'ROLLBACK' : 'COMMIT'])
    }
  })

  it('rejects nontransactional MySQL tables without writing', async () => {
    const client = mysqlClient()
    client.execute.mockResolvedValueOnce([[['NO']], []])
    await expect(new MysqlAdapter(client as never, 'app', '8.4').applyChanges(request)).rejects.toMatchObject({ code: 'DATABASE_TRANSACTION_UNAVAILABLE' })
    expect(client.execute).toHaveBeenCalledOnce()
    expect(client.query).not.toHaveBeenCalled()
  })

  it('closes an uncertain MySQL session after a commit failure', async () => {
    const client = mysqlClient()
    client.query.mockResolvedValueOnce([{}, []]).mockRejectedValueOnce(new Error('Connection lost during commit'))
    await expect(new MysqlAdapter(client as never, 'app', '8.4').applyChanges(request)).rejects.toMatchObject({ code: 'DATABASE_TRANSACTION_COMMIT_FAILED' })
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('closes the PostgreSQL read cursor before writing, then rolls back a failed batch', async () => {
    const calls: string[] = []
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (input: string | { text: string; queryMode?: string }) => {
        const text = typeof input === 'string' ? input : input.text
        calls.push(text)
        if (text === request.statements[1]) throw new Error('Constraint failed')
        if (request.statements.includes(text)) expect(input).toMatchObject({ queryMode: 'extended' })
        return { rows: [], fields: [], rowCount: 0 }
      }),
      end: vi.fn(async () => undefined)
    })
    const adapter = new PostgresAdapter(client as never, 'app', '17')
    await adapter.query({ sql: 'SELECT * FROM cells' })
    calls.length = 0
    await expect(adapter.applyChanges(request)).rejects.toThrow('Constraint failed')
    expect(calls).toEqual(['CLOSE "__remotehub_page"', 'COMMIT', 'BEGIN', ...request.statements, 'ROLLBACK'])
  })

  it('holds the session lock until the batch finishes, including metadata and database switches', async () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    let finish: (() => void) | undefined
    vi.spyOn(adapter, 'applyChanges').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const service = new DatabaseService({ markConnected: vi.fn() } as never, { get: vi.fn() } as never, { connect: async () => adapter })
    const { sessionId } = await service.connect({ id: '1', type: 'database', databaseType: 'mysql' } as never)
    const saving = service.applyChanges(sessionId, request)
    for (const operation of [service.query(sessionId, { sql: 'SELECT 1' }), service.useDatabase(sessionId, 'other'), service.listDatabases(sessionId)]) {
      await expect(operation).rejects.toMatchObject({ code: 'DATABASE_BUSY' })
    }
    finish?.()
    await expect(saving).resolves.toEqual({ ok: true })
    await expect(service.applyChanges(sessionId, { ...request, statements: ['DROP TABLE cells'] })).rejects.toMatchObject({ code: 'DATABASE_CHANGES_INVALID' })
    service.dispose()
  })

  it('keeps PostgreSQL manual transactions intact across reads, savepoint rollback and chained commits', async () => {
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (input: string | { text: string }) => {
        const text = typeof input === 'string' ? input : input.text
        const command = text.split(' ')[0]
        return { command, rows: [], fields: [], rowCount: 0 }
      }),
      end: vi.fn(async () => undefined)
    })
    const adapter = new PostgresAdapter(client as never, 'app', '17')
    await adapter.query({ sql: 'BEGIN' })
    await adapter.query({ sql: 'SELECT * FROM cells' })
    expect(client.query).toHaveBeenLastCalledWith({ text: 'SELECT * FROM cells', rowMode: 'array' })
    for (const sql of ['ROLLBACK TO SAVEPOINT edits', 'COMMIT AND CHAIN']) {
      await adapter.query({ sql })
      await expect(adapter.applyChanges(request)).rejects.toMatchObject({ code: 'DATABASE_TRANSACTION_ACTIVE' })
    }
    await adapter.query({ sql: 'ROLLBACK' })
    await expect(adapter.applyChanges(request)).resolves.toBeUndefined()
    client.query.mockRejectedValueOnce(new Error('Second statement failed'))
    await expect(adapter.query({ sql: 'BEGIN; INSERT INTO missing VALUES (1)' })).rejects.toThrow()
    await expect(adapter.applyChanges(request)).rejects.toMatchObject({ code: 'DATABASE_TRANSACTION_ACTIVE' })
  })
})
