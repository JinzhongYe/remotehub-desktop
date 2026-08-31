import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Run the JS entry point directly: spawning npm.cmd without a shell fails on
// recent Windows Node releases. Builder also rebuilds all production addons.
const result = spawnSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), 'install-app-deps'], {
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.status) process.exit(result.status)
