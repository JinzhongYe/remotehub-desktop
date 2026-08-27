import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { Connection } from '../../shared/types'
import { joinRemotePath, normalizeRemotePath, type SftpConnectResult, type SftpEntry, type SftpTransferEvent } from '../../shared/sftp'
import { sshErrorCode } from '../../shared/ssh'
import { CredentialService } from './credentials'
import { fingerprintHostKey, hostKeyState } from './host-key'
import { appError, StorageService } from './storage'

type SftpAttrs = { size?: number; mtime?: number; mode?: number }
type SftpListItem = { filename: string; attrs: SftpAttrs }
type SftpLike = {
  readdir(path: string, callback: (error: Error | undefined, list: SftpListItem[]) => void): void
  realpath(path: string, callback: (error: Error | undefined, resolved: string) => void): void
  mkdir(path: string, callback: (error?: Error) => void): void
  rename(oldPath: string, newPath: string, callback: (error?: Error) => void): void
  unlink(path: string, callback: (error?: Error) => void): void
  rmdir(path: string, callback: (error?: Error) => void): void
  fastPut(localPath: string, remotePath: string, options: { step: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void
  fastGet(remotePath: string, localPath: string, options: { step: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void
  end(): void
}
type SshClientLike = {
  on(event: string, listener: (...args: unknown[]) => void): SshClientLike
  connect(config: Record<string, unknown>): void
  sftp(callback: (error: Error | undefined, sftp: SftpLike) => void): void
  end(): void
}
type SshClientConstructor = new () => SshClientLike
type SftpSession = { id: string; connectionId: string; client: SshClientLike; sftp: SftpLike }
type EventSink = (channel: 'sftp:transfer', payload: SftpTransferEvent) => void

const loadNativeModule = createRequire(__filename)

export class SftpService {
  private readonly sessions = new Map<string, SftpSession>()
  private readonly pendingHostKeys = new Map<string, string>()

  constructor(private readonly storage: StorageService, private readonly credentials: CredentialService, private readonly send: EventSink) {}

  async connect(connection: Connection): Promise<SftpConnectResult> {
    if (connection.type !== 'ssh') throw appError('SFTP_CONNECTION_INVALID', 'SFTP requires an SSH connection')
    const credential = this.credentials.get(connection.credentialId)
    if (!credential) throw appError('CREDENTIAL_MISSING', 'Save a password or private key before connecting')
    const client = this.createClient()
    let receivedHostKey: string | undefined

    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        try { client.end() } catch { /* best effort */ }
        const state = receivedHostKey ? hostKeyState(connection.hostKeyFingerprint, receivedHostKey) : undefined
        if (state === 'new') {
          this.pendingHostKeys.set(connection.id, receivedHostKey!)
          resolve({ trustRequired: true, fingerprint: receivedHostKey! })
          return
        }
        if (state === 'changed') {
          reject(appError('SSH_HOST_KEY_CHANGED', `Host key changed for ${connection.host}:${connection.port}. Connection blocked.`))
          return
        }
        reject(toSftpError(error))
      }

      client.on('ready', () => {
        client.sftp((error, sftp) => {
          if (error) return fail(error)
          sftp.realpath('.', (pathError, homePath) => {
            if (pathError) return fail(pathError)
            if (settled) return
            settled = true
            const sessionId = randomUUID()
            this.sessions.set(sessionId, { id: sessionId, connectionId: connection.id, client, sftp })
            try { this.storage.markConnected(connection.id, Date.now()) } catch { /* metadata is best effort */ }
            resolve({ sessionId, homePath: normalizeRemotePath(homePath || '/') })
          })
        })
      })
      client.on('error', fail)
      client.on('end', () => this.removeClient(client))
      client.on('close', () => this.removeClient(client))
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

  list(sessionId: string, path: string): Promise<SftpEntry[]> {
    const session = this.getSession(sessionId)
    const normalized = validateRemotePath(path)
    return new Promise((resolve, reject) => session.sftp.readdir(normalized, (error, list) => {
      if (error) return reject(toSftpError(error))
      resolve(list
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => ({
          name: item.filename,
          path: joinRemotePath(normalized, item.filename),
          type: modeType(item.attrs.mode),
          size: Number(item.attrs.size || 0),
          modifiedAt: Number(item.attrs.mtime || 0) * 1000,
          mode: Number(item.attrs.mode || 0)
        }))
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
    }))
  }

  mkdir(sessionId: string, path: string): Promise<void> {
    return this.call(sessionId, 'mkdir', validateRemotePath(path))
  }

  rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const session = this.getSession(sessionId)
    return new Promise((resolve, reject) => session.sftp.rename(validateRemotePath(oldPath), validateRemotePath(newPath), (error) => error ? reject(toSftpError(error)) : resolve()))
  }

  remove(sessionId: string, path: string, type: 'file' | 'directory' | 'link'): Promise<void> {
    if (type !== 'file' && type !== 'directory' && type !== 'link') throw appError('SFTP_ENTRY_TYPE_INVALID', 'Remote entry type is invalid')
    return this.call(sessionId, type === 'directory' ? 'rmdir' : 'unlink', validateRemotePath(path))
  }

  upload(sessionId: string, localPath: string, remoteDirectory: string): Promise<{ transferId: string }> {
    if (typeof localPath !== 'string' || !localPath || localPath.length > 32767) throw appError('SFTP_LOCAL_PATH_INVALID', 'Local file path is invalid')
    const stat = statSync(localPath)
    if (!stat.isFile()) throw appError('SFTP_LOCAL_PATH_INVALID', 'Only files can be uploaded in Phase 4')
    const session = this.getSession(sessionId)
    const name = basename(localPath)
    const remotePath = joinRemotePath(validateRemotePath(remoteDirectory), name)
    return this.transfer(session, 'upload', name, stat.size, (step, done) => session.sftp.fastPut(localPath, remotePath, { step }, done))
  }

  download(sessionId: string, remotePath: string, localPath: string, size: number): Promise<{ transferId: string }> {
    if (typeof localPath !== 'string' || !localPath || localPath.length > 32767) throw appError('SFTP_LOCAL_PATH_INVALID', 'Local file path is invalid')
    const session = this.getSession(sessionId)
    const normalized = validateRemotePath(remotePath)
    return this.transfer(session, 'download', basename(normalized), Math.max(0, Number(size) || 0), (step, done) => session.sftp.fastGet(normalized, localPath, { step }, done))
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    try { session.sftp.end() } catch { /* best effort */ }
    try { session.client.end() } catch { /* best effort */ }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.disconnect(id)
    this.pendingHostKeys.clear()
  }

  private createClient(): SshClientLike {
    try {
      const module = loadNativeModule('ssh2') as { Client?: SshClientConstructor }
      if (!module.Client) throw new Error('ssh2 Client export is unavailable')
      return new module.Client()
    } catch {
      throw appError('SFTP_UNAVAILABLE', 'SFTP module is unavailable; run npm install and restart')
    }
  }

  private getSession(sessionId: string): SftpSession {
    if (typeof sessionId !== 'string' || sessionId.length > 100) throw appError('SFTP_SESSION_INVALID', 'SFTP session identifier is invalid')
    const session = this.sessions.get(sessionId)
    if (!session) throw appError('SFTP_SESSION_NOT_FOUND', 'SFTP session is not available')
    return session
  }

  private call(sessionId: string, method: 'mkdir' | 'unlink' | 'rmdir', path: string): Promise<void> {
    const session = this.getSession(sessionId)
    return new Promise((resolve, reject) => session.sftp[method](path, (error) => error ? reject(toSftpError(error)) : resolve()))
  }

  private transfer(session: SftpSession, direction: 'upload' | 'download', name: string, expectedTotal: number, start: (step: (transferred: number, chunk: number, total: number) => void, done: (error?: Error) => void) => void): Promise<{ transferId: string }> {
    const transferId = randomUUID()
    this.emit({ transferId, sessionId: session.id, direction, name, transferred: 0, total: expectedTotal, status: 'running' })
    try {
      start((transferred, _chunk, total) => this.emit({ transferId, sessionId: session.id, direction, name, transferred, total: total || expectedTotal, status: 'running' }), (error) => {
        this.emit({ transferId, sessionId: session.id, direction, name, transferred: error ? 0 : expectedTotal, total: expectedTotal, status: error ? 'error' : 'completed', message: error?.message })
      })
    } catch (error) {
      const failure = toSftpError(error)
      this.emit({ transferId, sessionId: session.id, direction, name, transferred: 0, total: expectedTotal, status: 'error', message: failure.message })
      throw failure
    }
    return Promise.resolve({ transferId })
  }

  private emit(event: SftpTransferEvent): void {
    try { this.send('sftp:transfer', event) } catch { /* renderer may already be closed */ }
  }

  private removeClient(client: SshClientLike): void {
    for (const [id, session] of this.sessions) if (session.client === client) this.sessions.delete(id)
  }
}

function validateRemotePath(path: string): string {
  if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0')) throw appError('SFTP_PATH_INVALID', 'Remote path is invalid')
  return normalizeRemotePath(path)
}

function modeType(mode = 0): SftpEntry['type'] {
  const kind = mode & 0o170000
  return kind === 0o040000 ? 'directory' : kind === 0o120000 ? 'link' : 'file'
}

function toSftpError(error: unknown): Error & { code: string } {
  const source = error as (NodeJS.ErrnoException & { level?: string }) | undefined
  return appError(sshErrorCode(source?.code, source?.level).replace(/^SSH_/, 'SFTP_'), error instanceof Error ? error.message : 'SFTP operation failed')
}
