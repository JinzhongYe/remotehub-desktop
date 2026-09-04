import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { DatabaseService } from '../src/main/services/database'
import type { DatabaseStatusEvent } from '../src/main/services/database/adapter'
import { MysqlAdapter } from '../src/main/services/database/mysql'
import { PostgresAdapter } from '../src/main/services/database/postgres'
import { SqliteAdapter } from '../src/main/services/database/sqlite'
import type { SessionConnectionStatusEvent } from '../src/shared/connection-status'
import type { Connection } from '../src/shared/types'

const connection: Connection = {
  id: 'shared-database', name: 'Database', type: 'database', databaseType: 'mysql', host: 'localhost', port: 3306,
  username: 'app', favorite: false, sortOrder: 0, createdAt: 1, updatedAt: 1
}

function mysqlClient() {
  return Object.assign(new EventEmitter(), {
    query: vi.fn(async () => [[], []]), execute: vi.fn(async () => [[], []]),
    changeUser: vi.fn(async () => undefined), ping: vi.fn(async () => undefined), destroy: vi.fn()
  })
}

function postgresClient() {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [], fields: [], rowCount: 0 })),
    end: vi.fn(async () => { client.emit('end') })
  })
  return client
}

describe('Database session lifecycle status', () => {
  it('tracks duplicate tabs independently and stops forwarding after disconnect', async () => {
    const clients = [mysqlClient(), mysqlClient()]
    let index = 0
    const factory = { connect: vi.fn(async () => new MysqlAdapter(clients[index++] as never, 'app', '8.4')) }
    const events: SessionConnectionStatusEvent[] = []
    const service = new DatabaseService({ markConnected: vi.fn() } as never, { get: vi.fn() } as never, factory, undefined, undefined, (event) => events.push(event))
    const first = await service.connect(connection)
    const second = await service.connect(connection)
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(events).toEqual([{ sessionId: first.sessionId, status: 'connected' }, { sessionId: second.sessionId, status: 'connected' }])

    clients[0].emit('error', Object.assign(new Error('Socket lost'), { fatal: true, code: 'ECONNRESET' }))
    clients[0].emit('end')
    expect(events.at(-1)).toEqual({ sessionId: first.sessionId, status: 'error', message: 'Socket lost' })
    expect(events.filter((event) => event.sessionId === second.sessionId)).toHaveLength(1)
    expect(clients[0].destroy).toHaveBeenCalledOnce()
    await expect(service.query(first.sessionId, { sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
    expect(() => service.listDatabases(first.sessionId)).toThrow('Database session is closed or missing')

    service.disconnect(first.sessionId)
    const count = events.length
    clients[0].emit('error', Object.assign(new Error('late failure'), { fatal: true }))
    clients[0].emit('end')
    expect(events).toHaveLength(count)
    expect(events.at(-1)).toEqual({ sessionId: first.sessionId, status: 'error', message: 'Socket lost' })
    expect(clients[1].destroy).not.toHaveBeenCalled()
    service.dispose()
    expect(clients[0].destroy).toHaveBeenCalledOnce()
    expect(clients[1].destroy).toHaveBeenCalledOnce()
  })

  it('cleans up terminal status replayed synchronously during subscription', async () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    client.emit('error', Object.assign(new Error('Early failure'), { fatal: true }))
    const subscribe = adapter.onStatus.bind(adapter)
    const unsubscribe = vi.fn()
    vi.spyOn(adapter, 'onStatus').mockImplementation((listener) => {
      const release = subscribe(listener)
      return () => { unsubscribe(); release() }
    })
    const events: SessionConnectionStatusEvent[] = []
    const service = new DatabaseService({ markConnected: vi.fn() } as never, { get: vi.fn() } as never, { connect: async () => adapter }, undefined, undefined, (event) => events.push(event))
    const result = await service.connect(connection)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(client.destroy).toHaveBeenCalledOnce()
    expect(events).toEqual([{ sessionId: result.sessionId, status: 'error', message: 'Early failure' }])
    await expect(service.query(result.sessionId, { sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
    client.emit('end')
    expect(events).toHaveLength(1)
  })

  it('removes ended sessions and closes their adapter', async () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    const events: SessionConnectionStatusEvent[] = []
    const service = new DatabaseService({ markConnected: vi.fn() } as never, { get: vi.fn() } as never, { connect: async () => adapter }, undefined, undefined, (event) => events.push(event))
    const result = await service.connect(connection)
    client.emit('end')
    expect(client.destroy).toHaveBeenCalledOnce()
    expect(events).toEqual([{ sessionId: result.sessionId, status: 'connected' }, { sessionId: result.sessionId, status: 'closed' }])
    await expect(service.query(result.sessionId, { sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
  })

  it('keeps lifecycle cleanup independent from a destroyed status recipient', async () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    const service = new DatabaseService({ markConnected: vi.fn() } as never, { get: vi.fn() } as never, { connect: async () => adapter }, undefined, undefined, () => { throw new Error('Renderer destroyed') })
    const result = await service.connect(connection)
    expect(() => client.emit('error', Object.assign(new Error('Socket lost'), { fatal: true }))).not.toThrow()
    expect(client.destroy).toHaveBeenCalledOnce()
    await expect(service.query(result.sessionId, { sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
    expect(() => service.disconnect(result.sessionId)).not.toThrow()
  })

  it('does not revive a removed PostgreSQL session after an in-flight database switch', async () => {
    const client = postgresClient()
    const replacement = postgresClient()
    const tunnel = { stream: undefined as never, close: vi.fn() }
    let finish: ((value: { client: never; database: string; serverVersion: string }) => void) | undefined
    const adapter = new PostgresAdapter(client as never, 'app', '17', tunnel, () => new Promise((resolve) => { finish = resolve }))
    const events: SessionConnectionStatusEvent[] = []
    const service = new DatabaseService({ markConnected: vi.fn() } as never, { get: vi.fn() } as never, undefined, { connect: async () => adapter }, undefined, (event) => events.push(event))
    const result = await service.connect({ ...connection, databaseType: 'postgres' })
    const switching = service.useDatabase(result.sessionId, 'analytics')
    await Promise.resolve()
    client.emit('error', new Error('Original transport failed'))
    finish?.({ client: replacement as never, database: 'analytics', serverVersion: '17' })
    await expect(switching).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
    await Promise.resolve()
    expect(tunnel.close).toHaveBeenCalledOnce()
    expect(replacement.end).toHaveBeenCalledOnce()
    expect(events).toEqual([{ sessionId: result.sessionId, status: 'connected' }, { sessionId: result.sessionId, status: 'error', message: 'Original transport failed' }])
    await expect(service.query(result.sessionId, { sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
  })

  it('retains driver failures occurring before the session subscribes', () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    client.emit('error', Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true }))
    const listener = vi.fn()
    adapter.onStatus(listener)
    expect(listener).toHaveBeenCalledWith({ status: 'error', message: 'Connection lost' })
  })

  it('keeps MySQL SQL and permission errors separate from fatal transport errors', async () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    const events: DatabaseStatusEvent[] = []
    adapter.onStatus((event) => events.push(event))
    for (const code of ['ER_PARSE_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']) {
      client.query.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
      await expect(adapter.query({ sql: 'UPDATE cells SET value = 1' })).rejects.toThrow(code)
    }
    expect(events).toEqual([{ status: 'connected' }])
    client.ping.mockRejectedValueOnce(Object.assign(new Error('Socket reset'), { fatal: true, code: 'ECONNRESET' }))
    await expect(adapter.ping()).rejects.toThrow('Socket reset')
    expect(events.at(-1)).toEqual({ status: 'error', message: 'Socket reset' })
  })

  it('reports remote end and explicit close without repeated notifications', () => {
    const client = mysqlClient()
    const adapter = new MysqlAdapter(client as never, 'app', '8.4')
    const listener = vi.fn()
    adapter.onStatus(listener)
    client.emit('end')
    adapter.close()
    adapter.close()
    expect(listener.mock.calls.map(([event]) => event.status)).toEqual(['connected', 'closed'])
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('reports idle PostgreSQL failures but not SQL errors', async () => {
    const client = postgresClient()
    const adapter = new PostgresAdapter(client as never, 'app', '17')
    const events: DatabaseStatusEvent[] = []
    adapter.onStatus((event) => events.push(event))
    client.query.mockRejectedValueOnce(Object.assign(new Error('Syntax error'), { code: '42601' }))
    await expect(adapter.query({ sql: 'UPDATE broken' })).rejects.toThrow('Syntax error')
    expect(events).toEqual([{ status: 'connected' }])
    client.emit('error', new Error('Connection terminated unexpectedly'))
    client.emit('end')
    expect(events.at(-1)).toEqual({ status: 'error', message: 'Connection terminated unexpectedly' })
  })

  it('follows a PostgreSQL replacement and ignores retired client events', async () => {
    const original = postgresClient()
    const replacement = postgresClient()
    const reconnect = vi.fn(async (database: string) => ({ client: replacement as never, database, serverVersion: '17' }))
    const adapter = new PostgresAdapter(original as never, 'app', '17', undefined, reconnect)
    const events: DatabaseStatusEvent[] = []
    adapter.onStatus((event) => events.push(event))
    reconnect.mockRejectedValueOnce(Object.assign(new Error('Missing database'), { code: '3D000' }))
    await expect(adapter.useDatabase('missing')).rejects.toThrow('Missing database')
    expect(events).toEqual([{ status: 'connected' }])

    await adapter.useDatabase('analytics')
    original.emit('error', new Error('Old socket error'))
    original.emit('end')
    expect(events).toEqual([{ status: 'connected' }])
    replacement.emit('end')
    expect(events.at(-1)).toEqual({ status: 'closed' })
  })

  it('cleans up a PostgreSQL replacement arriving after its tab closes', async () => {
    const original = postgresClient()
    const replacement = postgresClient()
    let finish: ((value: { client: never; database: string; serverVersion: string }) => void) | undefined
    const adapter = new PostgresAdapter(original as never, 'app', '17', undefined, () => new Promise((resolve) => { finish = resolve }))
    const events: DatabaseStatusEvent[] = []
    adapter.onStatus((event) => events.push(event))
    const switching = adapter.useDatabase('analytics')
    await Promise.resolve()
    adapter.close()
    finish?.({ client: replacement as never, database: 'analytics', serverVersion: '17' })
    await expect(switching).rejects.toMatchObject({ code: 'DATABASE_SESSION_NOT_FOUND' })
    expect(replacement.end).toHaveBeenCalledOnce()
    expect(events).toEqual([{ status: 'connected' }, { status: 'closed' }])
  })

  it('only treats a closed SQLite handle as disconnection', async () => {
    const client = { open: true, prepare: vi.fn(), close: vi.fn(() => { client.open = false }) }
    const adapter = new SqliteAdapter(client as never, 'SQLite test')
    const events: DatabaseStatusEvent[] = []
    adapter.onStatus((event) => events.push(event))
    for (const code of ['SQLITE_ERROR', 'SQLITE_READONLY', 'SQLITE_CANTOPEN', 'SQLITE_BUSY']) {
      client.prepare.mockImplementationOnce(() => { throw Object.assign(new Error(code), { code }) })
      await expect(adapter.query({ sql: 'UPDATE cells SET value = 1' })).rejects.toThrow(code)
    }
    expect(events).toEqual([{ status: 'connected' }])
    client.open = false
    client.prepare.mockImplementationOnce(() => { throw new Error('The database connection is not open') })
    await expect(adapter.ping()).rejects.toThrow('not open')
    expect(events.at(-1)).toEqual({ status: 'closed' })
    adapter.close()
    adapter.close()
    expect(client.close).toHaveBeenCalledOnce()
  })
})
