import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const candidates = process.platform === 'win32'
  ? ['release/win-unpacked/RemoteHub Desktop.exe']
  : process.platform === 'darwin'
    ? [`release/mac${process.arch === 'arm64' ? '-arm64' : ''}/RemoteHub Desktop.app/Contents/MacOS/RemoteHub Desktop`]
    : ['release/linux-unpacked/remotehub-desktop']
const executable = resolve(process.argv[2] || candidates[0])
if (!existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}. Run npm run pack first.`)
const temporaryRoot = resolve(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'remotehub-smoke-'))
try {
  const env = { ...process.env, REMOTEHUB_SMOKE_DIR: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, ['--smoke-test'], { env, stdio: 'inherit', windowsHide: true })
  const timeout = setTimeout(() => child.kill(), 45000)
  let code
  try {
    code = await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', accept)
    })
  } finally { clearTimeout(timeout) }
  const reportPath = join(directory, 'result.json')
  if (!existsSync(reportPath)) throw new Error(`Packaged smoke test did not report a result (exit ${code})`)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  if (code !== 0 || report.ok !== true) throw new Error(JSON.stringify(report))
  console.log(JSON.stringify(report, null, 2))
} finally {
  // Only remove the exact temporary child created above, never a caller path.
  if (dirname(directory) === temporaryRoot && directory.startsWith(join(temporaryRoot, 'remotehub-smoke-'))) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
