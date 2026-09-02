import type { SftpEntry } from './sftp'

// A navigation-only location, never a filesystem path or transfer destination.
export const LOCAL_COMPUTER_ROOT = 'remotehub://local-computer'
export type LocalShortcut = 'home' | 'desktop' | 'documents' | 'downloads'
export type LocalEntry = Pick<SftpEntry, 'name' | 'path' | 'type' | 'size' | 'modifiedAt'> & {
  location?: LocalShortcut | 'drive'
}
export type LocalDirectory = { path: string; parentPath: string; entries: LocalEntry[] }

export function localNavigationTarget(nextPath: string | undefined, currentPath: string): string | undefined {
  if (nextPath === undefined) return currentPath || undefined
  return nextPath.trim() ? nextPath : LOCAL_COMPUTER_ROOT
}

export function localTransferDirectory(path: string): string | null {
  return path && path !== LOCAL_COMPUTER_ROOT ? path : null
}
