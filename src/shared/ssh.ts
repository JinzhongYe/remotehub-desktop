export type SshSessionStatus = 'connecting' | 'connected' | 'error' | 'closed'

export type SshConnectResult = { sessionId: string; trustRequired?: false } | { trustRequired: true; fingerprint: string }

export interface SshDataEvent {
  sessionId: string
  data: string
}

export interface SshStatusEvent {
  sessionId: string
  status: SshSessionStatus
  message?: string
  code?: string
}

export function sshErrorCode(code?: string, level?: string): string {
  if (level === 'client-authentication') return 'SSH_AUTHENTICATION_FAILED'
  if (level === 'client-timeout' || code === 'ETIMEDOUT') return 'SSH_TIMEOUT'
  if (code === 'ECONNREFUSED') return 'SSH_CONNECTION_REFUSED'
  if (code === 'ENOTFOUND') return 'SSH_HOST_NOT_FOUND'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'SSH_NETWORK_UNREACHABLE'
  if (code === 'ECONNRESET') return 'SSH_CONNECTION_RESET'
  if (level === 'handshake' || level === 'protocol') return 'SSH_HANDSHAKE_FAILED'
  return 'SSH_CONNECTION_FAILED'
}
