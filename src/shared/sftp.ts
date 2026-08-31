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

export type SftpTransferStatus = 'queued' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled'

export interface SftpTransferItem {
  transferId: string
  sessionId: string
  direction: 'upload' | 'download'
  name: string
  relativePath: string
  transferred: number
  total: number
  speed: number
  status: SftpTransferStatus
  message?: string
  createdAt: number
  updatedAt: number
}

export type SftpTransferEvent = SftpTransferItem

export interface SftpTransferConflict {
  direction: 'upload' | 'download'
  path: string
  name: string
}

export interface SftpQueueResult {
  transferIds: string[]
  conflicts: SftpTransferConflict[]
}

export function fileIcon(type: SftpEntryType, name = ''): string {
  if (type === 'directory') return '📁'
  if (type === 'link') return '🔗'
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (/^(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(extension)) return '🖼️'
  if (/^(mp3|wav|flac|aac|ogg|m4a)$/.test(extension)) return '🎵'
  if (/^(mp4|mkv|mov|avi|webm)$/.test(extension)) return '🎞️'
  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(extension)) return '📦'
  if (/^(xls|xlsx|csv|ods)$/.test(extension)) return '📊'
  if (/^(js|jsx|ts|tsx|vue|html|css|json|ya?ml|xml|py|java|c|cpp|h|sh|ps1|sql)$/.test(extension)) return '⌨️'
  if (/^(exe|msi|bat|cmd|app|deb|rpm)$/.test(extension)) return '⚙️'
  return '📄'
}

export function transferProgress(item: Pick<SftpTransferItem, 'transferred' | 'total'>): number {
  return item.total > 0 ? Math.min(100, Math.max(0, Math.round(item.transferred / item.total * 100))) : 0
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
