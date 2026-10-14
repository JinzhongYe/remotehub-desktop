import { getElectronPlatform } from './electron'
import { getTauriPlatform } from './tauri'
import type { RemoteHubPlatform } from '../shared/platform'

export function getPlatform(): RemoteHubPlatform {
  return ['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM) ? getTauriPlatform() : getElectronPlatform()
}
