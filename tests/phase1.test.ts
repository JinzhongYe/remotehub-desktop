import { describe, expect, it } from 'vitest'
import { connectionErrorCode } from '../src/shared/connection'

describe('Phase 1 connection errors', () => {
  it('maps platform socket errors to stable UI codes', () => {
    expect(connectionErrorCode('ETIMEDOUT')).toBe('CONNECTION_TIMEOUT')
    expect(connectionErrorCode('ECONNREFUSED')).toBe('CONNECTION_REFUSED')
    expect(connectionErrorCode('ENOTFOUND')).toBe('HOST_NOT_FOUND')
    expect(connectionErrorCode('EHOSTUNREACH')).toBe('NETWORK_UNREACHABLE')
    expect(connectionErrorCode('UNKNOWN')).toBe('CONNECTION_FAILED')
  })
})
