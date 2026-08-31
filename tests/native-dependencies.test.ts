import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasPtyPrebuild } from '../scripts/native-dependencies.mjs'

describe('node-pty release prebuild selection', () => {
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
