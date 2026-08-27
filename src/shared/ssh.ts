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
