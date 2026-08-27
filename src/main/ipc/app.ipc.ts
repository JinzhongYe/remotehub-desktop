import { app, clipboard, ipcMain } from 'electron'

export function registerAppIpc(): void {
  ipcMain.handle('app:getInfo', () => ({
    name: 'RemoteHub',
    version: app.getVersion(),
    platform: process.platform,
    dataPath: app.getPath('userData')
  }))
  ipcMain.handle('app:copyText', (_event, text: string) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('Clipboard text is invalid')
    clipboard.writeText(text)
    return { ok: true }
  })
}
