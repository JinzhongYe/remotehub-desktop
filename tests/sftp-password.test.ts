import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { SftpService } from '../src/main/services/sftp'
import type { Connection } from '../src/shared/types'

const connection: Connection = { id: 'ssh', name: 'Server', host: 'server.test', port: 22, username: 'user', type: 'ssh', authType: 'none', favorite: false, sortOrder: 0, createdAt: 0, updatedAt: 0 }

function setup() {
  const sftp = Object.assign(new EventEmitter(), {
    realpath: (_path: string, done: (error: undefined, home: string) => void) => done(undefined, '/home/user'),
    end: vi.fn()
  })
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn(),
    end: vi.fn(),
    sftp: (done: (error: undefined, channel: unknown) => void) => done(undefined, sftp)
  })
  const storage = { getConnection: vi.fn(() => connection), saveConnection: vi.fn(), markConnected: vi.fn() }
  const credentials = { get: vi.fn(), save: vi.fn(() => 'saved-secret') }
  const service = new SftpService(storage as never, credentials as never, vi.fn())
  service['createClient'] = () => client as never
  return { service, client, storage, credentials }
}

describe('SFTP connection-time password', () => {
  it('uses the submitted temporary password without requiring a saved credential', async () => {
    const { service, client, credentials } = setup()
    const pending = service.connect(connection, { password: 'temporary', savePassword: false })
    expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({ username: 'user', password: 'temporary' }))
    client.emit('ready')
    const result = await pending
    expect(result).toMatchObject({ homePath: '/home/user' })
    expect(credentials.save).not.toHaveBeenCalled()
  })

  it('saves a requested password only after SFTP authentication succeeds', async () => {
    const { service, client, storage, credentials } = setup()
    const pending = service.connect(connection, { password: 'correct', savePassword: true })
    expect(credentials.save).not.toHaveBeenCalled()
    client.emit('ready')
    await pending
    expect(credentials.save).toHaveBeenCalledWith('Server', 'correct', undefined)
    expect(storage.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ authType: 'password', credentialId: 'saved-secret' }))
  })

  it('does not save a rejected password', async () => {
    const { service, client, credentials } = setup()
    const pending = service.connect(connection, { password: 'wrong', savePassword: true })
    const rejected = expect(pending).rejects.toThrow('Rejected')
    client.emit('error', Object.assign(new Error('Rejected'), { level: 'client-authentication' }))
    await rejected
    expect(credentials.save).not.toHaveBeenCalled()
  })
})
