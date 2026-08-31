import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version

const isWindows = process.platform === 'win32'

const result = spawnSync(
  'npm',
  ['rebuild', 'better-sqlite3', 'node-pty'],
  {
    stdio: 'inherit',
    shell: isWindows,
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers'
    }
  }
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
