import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { rebuild } from '@electron/rebuild'

export function hasPtyPrebuild(moduleDirectory, platform, arch) {
  const files = platform === 'win32'
    ? ['conpty.node', 'conpty_console_list.node', 'pty.node', 'winpty.dll', 'winpty-agent.exe', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']
    : platform === 'darwin' ? ['pty.node', 'spawn-helper'] : []
  return files.length > 0 && files.every(file => existsSync(join(moduleDirectory, 'prebuilds', `${platform}-${arch}`, file)))
}

export async function rebuildNativeDependencies({ appDir, electronVersion, platform = process.platform, arch = process.arch }) {
  const targetPlatform = typeof platform === 'string' ? platform : platform.nodeName
  if (targetPlatform !== process.platform) throw new Error('Build native dependencies on their target operating system')
  const require = createRequire(join(appDir, 'package.json'))
  const ptyDirectory = dirname(require.resolve('node-pty/package.json'))
  // node-pty ships Node-API binaries and helper executables on Windows/macOS.
  // Keep those vendor artifacts; rebuilding them is unnecessary and on Windows
  // would require an additional Spectre-enabled Visual Studio toolchain.
  const usePtyPrebuild = hasPtyPrebuild(ptyDirectory, targetPlatform, arch)
  console.log(`node-pty: ${usePtyPrebuild ? 'using bundled Node-API prebuilds' : 'building for Electron'} (${targetPlatform}-${arch})`)
  await rebuild({
    buildPath: appDir,
    electronVersion: electronVersion || require('electron/package.json').version,
    platform: targetPlatform,
    arch,
    mode: 'sequential',
    ignoreModules: usePtyPrebuild ? ['node-pty'] : []
  })
}
