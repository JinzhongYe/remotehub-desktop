export type SftpEntryType = 'file' | 'directory' | 'link'

export interface SftpEntry {
  name: string
  path: string
  type: SftpEntryType
  size: number
  modifiedAt: number
  mode: number
}

export type SftpConnectResult = { sessionId: string; homePath: string; trustRequired?: false } | { trustRequired: true; fingerprint: string }

export interface SftpTransferEvent {
  transferId: string
  sessionId: string
  direction: 'upload' | 'download'
  name: string
  transferred: number
  total: number
  status: 'running' | 'completed' | 'error'
  message?: string
}

export function normalizeRemotePath(path: string): string {
  const absolute = path.startsWith('/') ? path : `/${path}`
  const parts: string[] = []
  for (const segment of absolute.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return `/${parts.join('/')}`
}

export function joinRemotePath(parent: string, name: string): string {
  return normalizeRemotePath(`${parent}/${name}`)
}

export function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path)
  return normalized === '/' ? '/' : normalized.slice(0, normalized.lastIndexOf('/')) || '/'
}
