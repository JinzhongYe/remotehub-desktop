import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ensurePtyHelpersExecutable, hasPtyPrebuild } from '../scripts/native-dependencies.mjs'

describe('node-pty release prebuild selection', () => {
  it('restores execute permissions on macOS helpers before packaging', () => {
    const root = resolve('node_modules/node-pty')
    const helper = join(root, 'prebuilds/darwin-arm64/spawn-helper')
    const chmodSync = vi.fn()
    const io = {
      existsSync: (path: string) => path === helper,
      statSync: () => ({ isFile: () => true, mode: 0o100644 }),
      chmodSync
    }
    ensurePtyHelpersExecutable(root, 'darwin', 'arm64', io)
    expect(chmodSync).toHaveBeenCalledTimes(1)
    expect(chmodSync).toHaveBeenCalledWith(helper, 0o755)
    chmodSync.mockClear()
    ensurePtyHelpersExecutable(root, 'win32', 'x64', io)
    ensurePtyHelpersExecutable(root, 'linux', 'x64', io)
    expect(chmodSync).not.toHaveBeenCalled()
  })

  it('preserves already executable macOS helpers', () => {
    const chmodSync = vi.fn()
    ensurePtyHelpersExecutable(resolve('node_modules/node-pty'), 'darwin', 'x64', {
      existsSync: () => true,
      statSync: () => ({ isFile: () => true, mode: 0o100755 }),
      chmodSync
    })
    expect(chmodSync).not.toHaveBeenCalled()
  })

  it('requires both the native module and its helper for the exact architecture', () => {
    const root = resolve(tmpdir())
    const directory = mkdtempSync(join(root, 'remotehub-prebuild-test-'))
    try {
      const prebuild = join(directory, 'prebuilds', 'darwin-arm64')
      mkdirSync(prebuild, { recursive: true })
      writeFileSync(join(prebuild, 'pty.node'), '')
      expect(hasPtyPrebuild(directory, 'darwin', 'arm64')).toBe(false)
      writeFileSync(join(prebuild, 'spawn-helper'), '')
      expect(hasPtyPrebuild(directory, 'darwin', 'arm64')).toBe(true)
      expect(hasPtyPrebuild(directory, 'darwin', 'x64')).toBe(false)
      expect(hasPtyPrebuild(directory, 'linux', 'x64')).toBe(false)
    } finally {
      if (dirname(directory) !== root || !directory.startsWith(join(root, 'remotehub-prebuild-test-'))) throw new Error('Unsafe test cleanup path')
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
