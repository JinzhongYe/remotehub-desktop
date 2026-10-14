import type { RemoteHubPlatform } from '../shared/platform'

export function getElectronPlatform(): RemoteHubPlatform {
  if (typeof window === 'undefined' || !window.api) throw new Error('RemoteHub platform is unavailable')
  return window.api
}
