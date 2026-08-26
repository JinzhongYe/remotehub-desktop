import type { RemoteHubApi } from '../../preload'

declare global {
  interface Window {
    api: RemoteHubApi
  }
}

export {}
