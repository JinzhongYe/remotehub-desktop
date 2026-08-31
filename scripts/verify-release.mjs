import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.argv[2] || process.env.GITHUB_REF_NAME
if (!tag || tag !== `v${version}`) throw new Error(`Release tag must equal v${version}; received ${tag || '(none)'}`)
console.log(`Release version verified: ${tag}`)
