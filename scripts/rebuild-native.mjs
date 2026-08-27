import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['rebuild', 'better-sqlite3'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers'
  }
})

if (result.error) throw result.error
if (result.status) process.exit(result.status)
