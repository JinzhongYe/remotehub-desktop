import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appError } from './storage'

type CredentialFile = Record<string, { label: string; value: string }>

export class CredentialService {
  private readonly path = join(app.getPath('userData'), 'remotehub.credentials.json')

  save(label: string, secret: string, id: string = randomUUID()): string {
    if (typeof secret !== 'string' || !secret) throw appError('INVALID_CREDENTIAL', 'Credential cannot be empty')
    if (!/^[\w-]{1,160}$/.test(id)) throw appError('INVALID_CREDENTIAL_ID', 'Credential identifier is invalid')
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw appError('CREDENTIAL_STORE_UNAVAILABLE', 'System credential storage is unavailable')
    }
    const credentials = this.read()
    credentials[id] = { label: String(label).slice(0, 120), value: safeStorage.encryptString(secret).toString('base64') }
    this.write(credentials)
    return id
  }

  delete(id?: string): void {
    if (!id) return
    if (!/^[\w-]{1,160}$/.test(id)) throw appError('INVALID_CREDENTIAL_ID', 'Credential identifier is invalid')
    const credentials = this.read()
    if (!credentials[id]) return
    delete credentials[id]
    this.write(credentials)
  }

  private read(): CredentialFile {
    if (!existsSync(this.path)) return {}
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'))
      return value && typeof value === 'object' && !Array.isArray(value) ? value as CredentialFile : {}
    } catch {
      throw appError('CREDENTIAL_STORE_CORRUPT', 'Credential store cannot be read')
    }
  }

  private write(credentials: CredentialFile): void {
    const temporaryPath = `${this.path}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.path)
  }
}
