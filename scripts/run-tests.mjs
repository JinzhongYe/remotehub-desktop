import { startVitest } from 'vitest/node'

const vitest = await startVitest('test', [], { run: true, config: false, include: ['tests/**/*.test.ts'] })
process.exitCode = vitest?.state.getCountOfFailedTests() ? 1 : 0
