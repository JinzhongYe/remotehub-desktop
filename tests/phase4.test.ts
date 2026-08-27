import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { isPrivateKeyText, privateKeyFileName } from '../src/shared/private-key'
import { isValidBaudRate } from '../src/shared/serial'
import { joinRemotePath, normalizeRemotePath, parentRemotePath } from '../src/shared/sftp'
import { useWorkspaceStore } from '../src/renderer/stores/workspace'

describe('Phase 4 SFTP, serial, and private key files', () => {
  it('normalizes remote paths without escaping the remote root', () => {
    expect(normalizeRemotePath('/var/log/../tmp/./')).toBe('/var/tmp')
    expect(joinRemotePath('/home/user', '中文.txt')).toBe('/home/user/中文.txt')
    expect(parentRemotePath('/home/user')).toBe('/home')
    expect(parentRemotePath('/')).toBe('/')
  })

  it('recognizes OpenSSH, PEM, PKCS8, and PuTTY key files', () => {
    expect(isPrivateKeyText('-----BEGIN OPENSSH PRIVATE KEY-----\nkey')).toBe(true)
    expect(isPrivateKeyText('-----BEGIN RSA PRIVATE KEY-----\nkey')).toBe(true)
    expect(isPrivateKeyText('-----BEGIN PRIVATE KEY-----\nkey')).toBe(true)
    expect(isPrivateKeyText('PuTTY-User-Key-File-3: ssh-rsa')).toBe(true)
    expect(isPrivateKeyText('not a key')).toBe(false)
    expect(privateKeyFileName('C:\\keys\\mes.ppk')).toBe('mes.ppk')
  })

  it('validates practical serial baud rates', () => {
    expect(isValidBaudRate(9600)).toBe(true)
    expect(isValidBaudRate(115200)).toBe(true)
    expect(isValidBaudRate(0)).toBe(false)
    expect(isValidBaudRate(4_000_001)).toBe(false)
  })

  it('opens independent SFTP and serial terminal tabs', () => {
    setActivePinia(createPinia())
    const workspace = useWorkspaceStore()
    workspace.openConnection('ssh-1', 'Files', 'sftp')
    workspace.openConnection('serial-1', 'COM3', 'terminal')
    expect(workspace.tabs.at(-2)?.type).toBe('sftp')
    expect(workspace.tabs.at(-1)?.type).toBe('terminal')
  })
})
