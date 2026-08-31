import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { isPrivateKeyText, privateKeyFileName } from '../src/shared/private-key'
import { isValidBaudRate } from '../src/shared/serial'
import { fileIcon, joinRemotePath, normalizeRemotePath, parentRemotePath } from '../src/shared/sftp'
import { localShellCommand } from '../src/shared/local-shell'
import { parseServerStatus } from '../src/shared/ssh'
import { parseCodexStatus } from '../src/shared/codex'
import { useWorkspaceStore } from '../src/renderer/stores/workspace'

describe('Phase 4 SFTP, serial, and private key files', () => {
  it('normalizes remote paths without escaping the remote root', () => {
    expect(normalizeRemotePath('/var/log/../tmp/./')).toBe('/var/tmp')
    expect(joinRemotePath('/home/user', '中文.txt')).toBe('/home/user/中文.txt')
    expect(parentRemotePath('/home/user')).toBe('/home')
    expect(parentRemotePath('/')).toBe('/')
  })

  it('uses familiar folder and file-type icons', () => {
    expect(fileIcon('directory')).toBe('📁')
    expect(fileIcon('file', 'photo.png')).toBe('🖼️')
    expect(fileIcon('file', 'data.xlsx')).toBe('📊')
    expect(fileIcon('file', 'README')).toBe('📄')
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

  it('starts the operating system shell without another dependency', () => {
    expect(localShellCommand('win32', {})).toEqual({ command: 'powershell.exe', args: ['-NoLogo'] })
    expect(localShellCommand('linux', { SHELL: '/bin/bash' })).toEqual({ command: '/bin/bash', args: ['-i'] })
  })

  it('parses the SSH server overview response', () => {
    const status = parseServerStatus('user\troot\nhost\tserver.local\ncpu_percent\t12.5\nmemory_total_kb\t2048\nmemory_used_kb\t1024\nprocess\t42|3.5|128|sshd\n')
    expect(status).toMatchObject({ user: 'root', host: 'server.local', cpuPercent: 12.5, memoryTotalKb: 2048, memoryUsedKb: 1024 })
    expect(status.processes).toEqual([{ pid: 42, cpuPercent: 3.5, memoryKb: 128, command: 'sshd' }])
  })

  it('parses Codex quota windows and daily token usage', () => {
    const status = parseCodexStatus(
      { rateLimits: { planType: 'plus', primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: 123 }, secondary: { usedPercent: 13, windowDurationMins: 10080, resetsAt: 456 } } },
      { summary: { lifetimeTokens: 1000, peakDailyTokens: 700 }, dailyUsageBuckets: [{ startDate: '2026-08-30', tokens: 700 }] },
      789
    )
    expect(status).toMatchObject({ planType: 'plus', primary: { usedPercent: 82, windowDurationMins: 300 }, secondary: { usedPercent: 13 }, lifetimeTokens: 1000, checkedAt: 789 })
    expect(status.dailyUsageBuckets).toEqual([{ startDate: '2026-08-30', tokens: 700 }])
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
