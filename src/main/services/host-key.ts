import { createHash } from 'node:crypto'

export type HostKeyState = 'new' | 'trusted' | 'changed'

export function fingerprintHostKey(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export function hostKeyState(saved: string | undefined, received: string): HostKeyState {
  if (!saved) return 'new'
  return saved === received ? 'trusted' : 'changed'
}
