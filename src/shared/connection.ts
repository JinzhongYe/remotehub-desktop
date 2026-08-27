import type { ConnectionTestResult } from './types'

export function connectionErrorCode(code?: string): ConnectionTestResult['code'] {
  if (code === 'ETIMEDOUT') return 'CONNECTION_TIMEOUT'
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'HOST_NOT_FOUND'
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'NETWORK_UNREACHABLE'
  return 'CONNECTION_FAILED'
}
