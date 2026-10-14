import type { RemoteHubPlatform } from '../../shared/platform'

declare global {
  interface Window {
    api: RemoteHubPlatform
  }
}

export {}
