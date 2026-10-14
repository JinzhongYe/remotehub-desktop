import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cross-platform release version', () => {
  it('rejects a native version mismatch before publishing', () => {
    const root = mkdtempSync(join(tmpdir(), 'remotehub-release-version-'))
    try {
      mkdirSync(join(root, 'scripts'))
      mkdirSync(join(root, 'src-tauri'))
      copyFileSync(resolve('scripts/verify-release.mjs'), join(root, 'scripts/verify-release.mjs'))
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-beta.10' }))
      writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.0-beta.10' }))
      writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.1.0-beta.10"\n')
      const verify = () => execFileSync(process.execPath, [join(root, 'scripts/verify-release.mjs'), 'v0.1.0-beta.10'], { stdio: 'pipe' }).toString()
      expect(verify()).toContain('Release version verified')
      writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.1.0-beta.5"\n')
      expect(verify).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
