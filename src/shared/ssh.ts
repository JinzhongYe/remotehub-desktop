export type SshSessionStatus = 'connecting' | 'connected' | 'error' | 'closed'

export interface SshConnectResult {
  sessionId: string
}

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
  if (code === 'ETIMEDOUT') return 'SSH_TIMEOUT'
  if (code === 'ECONNREFUSED') return 'SSH_CONNECTION_REFUSED'
  if (code === 'ENOTFOUND') return 'SSH_HOST_NOT_FOUND'
  return 'SSH_CONNECTION_FAILED'
}
