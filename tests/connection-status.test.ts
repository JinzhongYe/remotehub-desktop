import { EventEmitter } from 'node:events'
import { Socket } from 'node:net'
import { Client } from 'basic-ftp'
import { describe, expect, it, vi } from 'vitest'
import { createSessionStatusTracker, type SessionConnectionStatusEvent } from '../src/shared/connection-status'
import type { Connection } from '../src/shared/types'
import { SftpService } from '../src/main/services/sftp'
import { FtpService } from '../src/main/services/ftp'

const profile: Connection = { id: 'same-profile', name: 'Server', type: 'ssh', host: 'localhost', port: 22, favorite: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }

describe('per-tab session status tracking', () => {
  it('starts connecting and only replays the matching early session event', () => {
    const report = vi.fn()
    const tracker = createSessionStatusTracker(report)
    tracker.start()
    tracker.handle({ sessionId: 'other-tab', status: 'error' })
    tracker.handle({ sessionId: 'this-tab', status: 'closed' })
    tracker.bind('this-tab')
    expect(report.mock.calls.map(([status]) => status)).toEqual(['connecting', 'closed'])
    tracker.handle({ sessionId: 'other-tab', status: 'connected' })
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('reports success, connect failure and deliberate closure without persisting state', () => {
    const report = vi.fn()
    const tracker = createSessionStatusTracker(report)
    tracker.start()
    tracker.bind('first-session')
    tracker.start()
    tracker.finish('error', 'Authentication failed')
    tracker.handle({ sessionId: 'first-session', status: 'closed' })
    tracker.start()
    tracker.bind('second-session')
    tracker.finish('closed')
    tracker.handle({ sessionId: 'second-session', status: 'connected' })
    expect(report.mock.calls.map(([status]) => status)).toEqual(['connecting', 'connected', 'connecting', 'error', 'connecting', 'connected', 'closed'])
  })
})

describe('remote file session lifecycle', () => {
  function sftpHarness() {
    const events: SessionConnectionStatusEvent[] = []
    const clients: EventEmitter[] = []
    const channels: EventEmitter[] = []
    const service = new SftpService({ markConnected: vi.fn() } as never, { get: () => 'password' } as never, (channel, event) => {
      if (channel === 'sftp:status') events.push(event as SessionConnectionStatusEvent)
    })
    service['createClient'] = () => {
      const channel = Object.assign(new EventEmitter(), {
        realpath: (_path: string, callback: (error: undefined, path: string) => void) => callback(undefined, '/home'),
        readdir: (_path: string, callback: (error: Error) => void) => callback(Object.assign(new Error('Permission denied'), { code: 3 })),
        end: () => channel.emit('end')
      })
      const client = Object.assign(new EventEmitter(), {
        connect: () => queueMicrotask(() => client.emit('ready')),
        sftp: (callback: (error: undefined, value: unknown) => void) => callback(undefined, channel),
        end: () => client.emit('end')
      })
      channels.push(channel)
      clients.push(client)
      return client as never
    }
    return { service, events, clients, channels }
  }

  it('isolates duplicate SFTP sessions and leaves permission errors connected', async () => {
    const { service, events, clients } = sftpHarness()
    const first = await service.connect(profile)
    const second = await service.connect(profile)
    if (first.trustRequired || second.trustRequired) throw new Error('Unexpected host-key request')
    await expect(service.list(first.sessionId, '/private')).rejects.toThrow('Permission denied')
    expect(events.map((event) => event.status)).toEqual(['connected', 'connected'])
    clients[0].emit('error', new Error('Connection reset'))
    clients[0].emit('close')
    expect(events.at(-1)).toMatchObject({ sessionId: first.sessionId, status: 'error' })
    expect(() => service.list(first.sessionId, '/')).toThrow('not available')
    expect(events.filter((event) => event.sessionId === second.sessionId)).toHaveLength(1)
    service.disconnect(second.sessionId)
    expect(events.at(-1)).toMatchObject({ sessionId: second.sessionId, status: 'closed' })
    expect(events).toHaveLength(4)
  })

  it('reports SFTP subsystem peer close even when the SSH client remains open', async () => {
    const { service, events, channels } = sftpHarness()
    const session = await service.connect(profile)
    if (session.trustRequired) throw new Error('Unexpected host-key request')
    channels[0].emit('close')
    expect(events.at(-1)).toMatchObject({ sessionId: session.sessionId, status: 'closed' })
    expect(() => service.list(session.sessionId, '/')).toThrow('not available')
  })

  function ftpHarness() {
    const events: SessionConnectionStatusEvent[] = []
    const socket = new EventEmitter()
    const ftp = { socket, closeWithError: vi.fn() }
    const client = {
      ftp,
      pwd: async () => '/',
      list: async () => { throw Object.assign(new Error('Permission denied'), { code: 550 }) },
      close: () => ftp.closeWithError(new Error('User closed connection'))
    }
    const service = new FtpService({ markConnected: vi.fn() } as never, { get: () => 'password' } as never, (channel, event) => {
      if (channel === 'ftp:status') events.push(event as SessionConnectionStatusEvent)
    })
    service['openClient'] = async () => client as never
    return { service, events, client, socket }
  }

  it('keeps FTP connected after a file error but reports control transport failure', async () => {
    const { service, events, client } = ftpHarness()
    const session = await service.connect({ ...profile, type: 'ftp', port: 21 })
    if (session.trustRequired) throw new Error('Unexpected host-key request')
    await expect(service.list(session.sessionId, '/private')).rejects.toThrow('Permission denied')
    expect(events.map((event) => event.status)).toEqual(['connected'])
    client.ftp.closeWithError(new Error('Connection reset'))
    expect(events.at(-1)).toMatchObject({ sessionId: session.sessionId, status: 'error' })
    expect(() => service.list(session.sessionId, '/')).toThrow('not available')
    expect(events).toHaveLength(2)
  })

  it('reports FTP peer FIN and deliberate disconnect as closed, once', async () => {
    const { service, events, client, socket } = ftpHarness()
    const session = await service.connect({ ...profile, type: 'ftp', port: 21 })
    if (session.trustRequired) throw new Error('Unexpected host-key request')
    socket.emit('end')
    client.ftp.closeWithError(new Error('Server sent FIN'))
    service.disconnect(session.sessionId)
    expect(events.map((event) => event.status)).toEqual(['connected', 'closed'])
    const next = ftpHarness()
    const nextSession = await next.service.connect({ ...profile, type: 'ftp', port: 21 })
    if (nextSession.trustRequired) throw new Error('Unexpected host-key request')
    next.service.disconnect(nextSession.sessionId)
    expect(next.events.map((event) => event.status)).toEqual(['connected', 'closed'])
  })

  it.each(['peer-fin', 'control-error', 'data-error'] as const)('observes installed basic-ftp %s shutdown and listener removal', async (reason) => {
    const events: SessionConnectionStatusEvent[] = []
    const client = new Client()
    // Exercise the installed FTPContext implementation without opening sockets.
    // Only the completed handshake's PWD result and writes are stubbed.
    vi.spyOn(client, 'pwd').mockResolvedValue('/')
    vi.spyOn(client.ftp.socket, 'write').mockReturnValue(true)
    Object.defineProperty(client.ftp.socket, 'remoteAddress', { value: '127.0.0.1' })
    const service = new FtpService({ markConnected: vi.fn() } as never, { get: () => 'password' } as never, (channel, event) => {
      if (channel === 'ftp:status') events.push(event as SessionConnectionStatusEvent)
    })
    service['openClient'] = async () => client
    try {
      const session = await service.connect({ ...profile, type: 'ftp', port: 21 })
      if (session.trustRequired) throw new Error('Unexpected host-key request')
      expect(client.closed).toBe(false)
      if (reason === 'peer-fin') client.ftp.socket.emit('end')
      else if (reason === 'control-error') client.ftp.socket.emit('error', new Error('Connection reset'))
      else {
        client.ftp.dataSocket = new Socket()
        client.ftp.dataSocket.emit('error', new Error('Data connection reset'))
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(client.closed).toBe(true)
      expect(events.map((event) => event.status)).toEqual(['connected', reason === 'peer-fin' ? 'closed' : 'error'])
      expect(() => service.list(session.sessionId, '/')).toThrow('not available')
    } finally {
      service.dispose()
      client.close()
    }
  })
})
