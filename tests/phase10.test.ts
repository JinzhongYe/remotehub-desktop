import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(path), 'utf8')

describe('Phase 10 release contracts', () => {
  it('packages only runtime outputs and unpacks native addons', () => {
    const config = JSON.parse(read('electron-builder.json'))
    expect(config.files).toEqual(['dist/**/*', 'dist-electron/**/*', 'package.json', '!**/*.map'])
    expect(config.asar).toBe(true)
    expect(config.asarUnpack).toContain('**/*.node')
    expect(config.npmRebuild).toBe(true)
    expect(config.publish).toBeNull()
  })

  it('provides distinct installers for each target', () => {
    const config = JSON.parse(read('electron-builder.json'))
    expect(config.win.target).toEqual(['nsis', 'portable'])
    expect(config.nsis.artifactName).not.toBe(config.portable.artifactName)
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false)
    expect(config.mac.target).toEqual(['dmg'])
    expect(config.linux.target).toEqual(['AppImage'])
    for (const target of ['nsis', 'portable', 'mac', 'linux']) {
      expect(config[target].artifactName).toContain('${version}')
      expect(config[target].artifactName).toContain('${arch}')
    }
  })

  it('uses the same npm version lock and explicit offline/development modes', () => {
    const pkg = JSON.parse(read('package.json'))
    const lock = JSON.parse(read('package-lock.json'))
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(pkg.scripts.dev).toContain('electron . --dev')
    const main = read('src/main/index.ts')
    expect(main).toContain("!app.isPackaged && app.commandLine.hasSwitch('dev')")
    expect(main).toContain("join(app.getPath('appData'), 'remotehub-desktop')")
    expect(main).toContain('sandbox: true')
  })

  it('requires all packaged smoke tests before publishing a preview', () => {
    const workflow = read('.github/workflows/release.yml')
    expect(workflow).toContain('needs: build')
    expect(workflow).toContain('npm run test:packaged')
    expect(workflow).toContain('--verify-tag --prerelease')
    expect(workflow).toContain('macos-15-intel')
    expect(workflow).toContain('arch: arm64')
    expect(workflow).toContain('npm run release:checksums')
  })
})
