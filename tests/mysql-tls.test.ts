import { describe, expect, it, vi } from 'vitest'
import { mysqlAdapterFactory } from '../src/main/services/database/mysql'
import type { Connection } from '../src/shared/types'

const connect = vi.hoisted(() => vi.fn())
vi.mock('mysql2/promise', () => ({ createConnection: connect }))

const connection: Connection = {
  id: 'mysql', name: 'MySQL', type: 'database', databaseType: 'mysql', host: 'db.example', port: 3306,
  username: 'app', favorite: false, sortOrder: 0, createdAt: 1, updatedAt: 1
}

describe('MySQL TLS configuration', () => {
  it.each([
    ['require', { rejectUnauthorized: false, verifyIdentity: false }],
    ['verify-full', { rejectUnauthorized: true, verifyIdentity: true }],
    ['disable', undefined]
  ] as const)('honors the %s transport mode', async (databaseSslMode, ssl) => {
    connect.mockResolvedValueOnce({ query: vi.fn(async () => [[['8.4']], []]), on: vi.fn() })
    await mysqlAdapterFactory.connect({ ...connection, databaseSslMode }, 'secret')
    expect(connect).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'db.example', ssl }))
  })
})
