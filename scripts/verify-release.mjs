import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.argv[2] || process.env.GITHUB_REF_NAME
if (!tag || tag !== `v${version}`) throw new Error(`Release tag must equal v${version}; received ${tag || '(none)'}`)
console.log(`Release version verified: ${tag}`)
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const nativeVersion = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]
if (tauri.version !== version || nativeVersion !== version) throw new Error('npm, Tauri and Rust release versions must match')
