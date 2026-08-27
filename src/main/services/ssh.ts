import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type { Connection } from '../../shared/types'
import { sshErrorCode, type SshConnectResult, type SshDataEvent, type SshStatusEvent } from '../../shared/ssh'
import { CredentialService } from './credentials'
import { fingerprintHostKey, hostKeyState } from './host-key'
import { appError, StorageService } from './storage'

type EventSink = (channel: 'ssh:data' | 'ssh:status', payload: SshDataEvent | SshStatusEvent) => void

type SshStreamLike = {
  on(event: string, listener: (...args: unknown[]) => void): SshStreamLike
  write(data: string): boolean
  setWindow(rows: number, cols: number, height: number, width: number): void
  close(): void
}

type SshClientLike = {
  on(event: string, listener: (...args: unknown[]) => void): SshClientLike
  connect(config: Record<string, unknown>): void
  shell(options: Record<string, unknown>, callback: (error: Error | undefined, stream: SshStreamLike) => void): void
  end(): void
}

type SshClientConstructor = new () => SshClientLike

type SshSession = {
  id: string
  connectionId: string
  client: SshClientLike
  stream?: SshStreamLike
}

const loadNativeModule = createRequire(__filename)

export class SshService {
  private readonly sessions = new Map<string, SshSession>()
  private readonly pendingHostKeys = new Map<string, string>()

  constructor(private readonly storage: StorageService, private readonly credentials: CredentialService, private readonly send: EventSink) {}

  async connect(connection: Connection): Promise<SshConnectResult> {
    if (connection.type !== 'ssh') throw appError('SSH_CONNECTION_INVALID', 'Only SSH connections can open a terminal')
    const credential = this.credentials.get(connection.credentialId)
    if (!credential) throw appError('CREDENTIAL_MISSING', 'Save a password or private key before connecting')

    const client = this.createClient()
    const sessionId = randomUUID()
    const session: SshSession = { id: sessionId, connectionId: connection.id, client }
    this.sessions.set(sessionId, session)
    this.emitStatus({ sessionId, status: 'connecting' })

    return new Promise((resolve, reject) => {
      let settled = false
      let receivedHostKey: string | undefined
      const fail = (error: unknown): void => {
        if (!this.sessions.has(sessionId)) return
        const keyState = receivedHostKey ? hostKeyState(connection.hostKeyFingerprint, receivedHostKey) : undefined
        if (keyState === 'new') {
          this.pendingHostKeys.set(connection.id, receivedHostKey!)
          this.closeSession(sessionId, false)
          if (!settled) {
            settled = true
            resolve({ trustRequired: true, fingerprint: receivedHostKey! })
          }
          return
        }
        const appFailure = keyState === 'changed'
          ? appError('SSH_HOST_KEY_CHANGED', `Host key changed for ${connection.host}:${connection.port}. Expected ${connection.hostKeyFingerprint}, received ${receivedHostKey}. Connection blocked.`)
          : toSshError(error)
        this.emitStatus({ sessionId, status: 'error', code: appFailure.code, message: appFailure.message })
        this.closeSession(sessionId, false)
        if (!settled) {
          settled = true
          reject(appFailure)
        }
      }

      client.on('ready', () => {
        client.shell({ term: 'xterm-256color', cols: 120, rows: 32 }, (error, stream) => {
          if (error) return fail(error)
          session.stream = stream
          stream.on('data', (chunk: unknown) => this.emitData({ sessionId, data: Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk) }))
          stream.on('error', fail)
          stream.on('close', () => this.closeSession(sessionId, true))
          stream.on('end', () => this.closeSession(sessionId, true))
          if (!settled) {
            settled = true
            try { this.storage.markConnected(connection.id, Date.now()) } catch { /* connection metadata is best effort */ }
            this.emitStatus({ sessionId, status: 'connected' })
            resolve({ sessionId })
          }
        })
      })
      client.on('error', fail)
      client.on('end', () => this.closeSession(sessionId, true))
      client.on('close', () => this.closeSession(sessionId, true))

      try {
        client.connect({
          host: connection.host,
          port: connection.port,
          username: connection.username,
          readyTimeout: 10000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer) => {
            receivedHostKey = fingerprintHostKey(key)
            return hostKeyState(connection.hostKeyFingerprint, receivedHostKey) === 'trusted'
          },
          ...(connection.authType === 'privateKey' ? { privateKey: credential } : { password: credential })
        })
      } catch (error) {
        fail(error)
      }
    })
  }

  trustHostKey(connectionId: string, fingerprint: string): void {
    if (this.storage.getConnection(connectionId)?.hostKeyFingerprint === fingerprint) return
    if (typeof connectionId !== 'string' || connectionId.length > 100 || this.pendingHostKeys.get(connectionId) !== fingerprint) {
      throw appError('SSH_HOST_KEY_INVALID', 'Host key confirmation is invalid or expired')
    }
    this.storage.trustHostKey(connectionId, fingerprint)
    this.pendingHostKeys.delete(connectionId)
  }

  write(sessionId: string, data: string): void {
    if (typeof data !== 'string' || data.length > 1024 * 1024) throw appError('SSH_INPUT_INVALID', 'Terminal input is invalid')
    const session = this.sessions.get(sessionId)
    if (!session?.stream) throw appError('SSH_SESSION_NOT_FOUND', 'SSH session is not available')
    session.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 300 || rows < 1 || rows > 200) {
      throw appError('SSH_RESIZE_INVALID', 'Terminal size is invalid')
    }
    const session = this.sessions.get(sessionId)
    if (!session?.stream) throw appError('SSH_SESSION_NOT_FOUND', 'SSH session is not available')
    session.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(sessionId: string): void {
    if (typeof sessionId !== 'string' || sessionId.length > 100) throw appError('SSH_SESSION_INVALID', 'SSH session identifier is invalid')
    this.closeSession(sessionId, true)
  }

  dispose(): void {
    for (const sessionId of this.sessions.keys()) this.closeSession(sessionId, false)
    this.pendingHostKeys.clear()
  }

  private createClient(): SshClientLike {
    try {
      const module = loadNativeModule('ssh2') as { Client?: SshClientConstructor }
      if (!module.Client) throw new Error('ssh2 Client export is unavailable')
      return new module.Client()
    } catch {
      throw appError('SSH_UNAVAILABLE', 'SSH module is unavailable; run npm install and restart')
    }
  }

  private closeSession(sessionId: string, notify: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    try { session.stream?.close() } catch { /* best effort */ }
    try { session.client.end() } catch { /* best effort */ }
    if (notify) this.emitStatus({ sessionId, status: 'closed' })
  }

  private emitData(event: SshDataEvent): void {
    try { this.send('ssh:data', event) } catch { /* the renderer may already be closed */ }
  }

  private emitStatus(event: SshStatusEvent): void {
    try { this.send('ssh:status', event) } catch { /* the renderer may already be closed */ }
  }
}

function toSshError(error: unknown): Error & { code: string } {
  const source = error as (NodeJS.ErrnoException & { level?: string }) | undefined
  const code = sshErrorCode(source?.code, source?.level)
  const message = code === 'SSH_AUTHENTICATION_FAILED'
    ? 'Authentication failed. Check the saved username and password or private key.'
    : error instanceof Error ? error.message : 'SSH connection failed'
  return appError(code, message)
}
