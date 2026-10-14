import { getPlatform } from '../platform'
import type { RemoteHubPlatform, StorageProvider } from '../shared/platform'

type ProviderName = Exclude<keyof RemoteHubPlatform, 'capabilities'>

function platformService<K extends ProviderName>(name: K): NonNullable<RemoteHubPlatform[K]> {
  return new Proxy({}, {
    get(_target, property) {
      const provider = getPlatform()[name]
      if (!provider) throw new Error(`${String(name)} is not supported on this platform`)
      const value = Reflect.get(provider, property)
      return typeof value === 'function' ? value.bind(provider) : value
    }
  }) as NonNullable<RemoteHubPlatform[K]>
}

export function getPlatformCapabilities(): RemoteHubPlatform['capabilities'] {
  return getPlatform().capabilities
}

const webStorage: StorageProvider = {
  get: async (key) => localStorage.getItem(key),
  set: async (key, value) => { localStorage.setItem(key, value); return { ok: true } },
  remove: async (key) => { localStorage.removeItem(key); return { ok: true } }
}

export const storageService: StorageProvider = new Proxy({} as StorageProvider, {
  get(_target, property) {
    const provider = ['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM) ? getPlatform().storage : webStorage
    if (!provider) throw new Error('Storage is not supported on this platform')
    const value = Reflect.get(provider, property)
    return typeof value === 'function' ? value.bind(provider) : value
  }
})

export const appService = platformService('app')
export const fileService = platformService('files')
export const connectionService = platformService('connections')
export const sshService = platformService('ssh')
export const sftpService = platformService('sftp')
export const ftpService = platformService('ftp')
export const serialService = platformService('serial')
export const shellService = platformService('shell')
export const databaseService = platformService('database')
export const groupService = platformService('groups')
