import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const directory = resolve(process.argv[2] || 'release')
const files = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(exe|dmg|AppImage)$/.test(entry.name))
  .map((entry) => entry.name).sort()
if (!files.length) throw new Error('No release installers found')
const lines = []
for (const name of files) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk)
  lines.push(`${hash.digest('hex')}  ${name}`)
}
writeFileSync(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
console.log(`Wrote SHA256SUMS.txt for ${files.length} installers`)
