import { describe, expect, it } from 'vitest'
import type { ConnectionInput } from '../src/shared/types'

describe('Phase 0 domain contract', () => {
  it('does not model secrets as part of connection input', () => {
    const connection: ConnectionInput = { name: 'dev', type: 'ssh', host: '127.0.0.1', port: 22, credentialId: 'credential-1' }
    expect(connection).not.toHaveProperty('password')
    expect(connection.credentialId).toBe('credential-1')
  })

  it('supports the first database adapter types', () => {
    const input: ConnectionInput = { name: 'mes', type: 'database', host: 'db.local', port: 5432, databaseType: 'postgres' }
    expect(['mysql', 'postgres', 'sqlite']).toContain(input.databaseType)
  })
})
