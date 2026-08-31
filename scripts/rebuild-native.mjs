import { fileURLToPath } from 'node:url'
import { rebuildNativeDependencies } from './native-dependencies.mjs'

await rebuildNativeDependencies({ appDir: fileURLToPath(new URL('../', import.meta.url)) })
