/** Runtime session state only; never save this on a connection profile. */
export type TabConnectionStatus = 'connecting' | 'connected' | 'error' | 'closed'

export interface SessionConnectionStatusEvent {
  sessionId: string
  status: TabConnectionStatus
  message?: string
}

/** Handles lifecycle events that can arrive before the connect IPC reply. */
export function createSessionStatusTracker(report: (status: TabConnectionStatus, message?: string) => void) {
  let sessionId = ''
  let pending = false
  const earlyEvents = new Map<string, SessionConnectionStatusEvent>()
  return {
    start(): void {
      sessionId = ''
      pending = true
      earlyEvents.clear()
      report('connecting')
    },
    bind(id: string): void {
      sessionId = id
      pending = false
      const event = earlyEvents.get(id)
      earlyEvents.clear()
      report(event?.status ?? 'connected', event?.message)
    },
    handle(event: SessionConnectionStatusEvent): void {
      if (event.sessionId === sessionId) report(event.status, event.message)
      else if (pending) earlyEvents.set(event.sessionId, event)
    },
    finish(status: 'error' | 'closed', message?: string): void {
      sessionId = ''
      pending = false
      earlyEvents.clear()
      report(status, message)
    }
  }
}
