import type { DatabaseStatusEvent } from './adapter'

/** Retains early driver events until the owning session subscribes. */
export class DatabaseLifecycle {
  private current: DatabaseStatusEvent = { status: 'connected' }
  private readonly listeners = new Set<(event: DatabaseStatusEvent) => void>()

  subscribe(listener: (event: DatabaseStatusEvent) => void): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => this.listeners.delete(listener)
  }

  connected(): void { this.publish({ status: 'connected' }) }

  failed(message: string): void {
    if (this.current.status !== 'connected') return
    this.publish({ status: 'error', message })
  }

  ended(): void {
    // The usual end after an error must not erase its useful reason.
    if (this.current.status === 'connected') this.publish({ status: 'closed' })
  }

  closed(): void { this.publish({ status: 'closed' }) }

  private publish(event: DatabaseStatusEvent): void {
    if (event.status === this.current.status && event.message === this.current.message) return
    this.current = event
    for (const listener of this.listeners) listener(event)
  }
}
