import { describe, expect, it } from 'vitest'
import { sshErrorCode, type SshDataEvent, type SshStatusEvent } from '../src/shared/ssh'

describe('Phase 2 SSH foundation', () => {
  it('uses serializable payloads for terminal output and status events', () => {
    const data: SshDataEvent = { sessionId: 'session-1', data: 'ok\r\n' }
    const status: SshStatusEvent = { sessionId: 'session-1', status: 'connected' }

    expect(data).toEqual({ sessionId: 'session-1', data: 'ok\r\n' })
    expect(status).toEqual({ sessionId: 'session-1', status: 'connected' })
  })

  it('supports status error metadata without exposing credentials', () => {
    const status: SshStatusEvent = {
      sessionId: 'session-1',
      status: 'error',
      code: 'SSH_TIMEOUT',
      message: 'Connection timed out'
    }

    expect(status).toMatchObject({ status: 'error', code: 'SSH_TIMEOUT' })
    expect(status).not.toHaveProperty('password')
    expect(status).not.toHaveProperty('privateKey')
  })

  it('distinguishes rejected credentials from network failures', () => {
    expect(sshErrorCode(undefined, 'client-authentication')).toBe('SSH_AUTHENTICATION_FAILED')
    expect(sshErrorCode('ETIMEDOUT')).toBe('SSH_TIMEOUT')
  })
})
