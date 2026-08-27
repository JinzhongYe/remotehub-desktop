import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isPrivateKeyText } from '../../shared/private-key'
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

  savePrivateKeyFile(label: string, filePath: string, id?: string): string {
    if (typeof filePath !== 'string' || !isAbsolute(filePath) || !existsSync(filePath)) {
      throw appError('PRIVATE_KEY_FILE_INVALID', 'Private key file does not exist')
    }
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) {
      throw appError('PRIVATE_KEY_FILE_INVALID', 'Private key file must be a file smaller than 1 MB')
    }
    const key = readFileSync(filePath, 'utf8')
    if (!isPrivateKeyText(key)) {
      throw appError('PRIVATE_KEY_FORMAT_UNSUPPORTED', 'Supported private key formats are OpenSSH, PEM and PuTTY PPK')
    }
    return this.save(label, key, id)
  }

  get(id?: string): string | undefined {
    if (!id) return undefined
    if (!/^[\w-]{1,160}$/.test(id)) throw appError('INVALID_CREDENTIAL_ID', 'Credential identifier is invalid')
    const entry = this.read()[id]
    if (!entry) return undefined
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw appError('CREDENTIAL_STORE_UNAVAILABLE', 'System credential storage is unavailable')
    }
    try {
      return safeStorage.decryptString(Buffer.from(entry.value, 'base64'))
    } catch {
      throw appError('CREDENTIAL_DECRYPT_FAILED', 'Saved credential cannot be decrypted')
    }
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
