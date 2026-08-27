import { app, clipboard, dialog, ipcMain } from 'electron'

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
  ipcMain.handle('app:choosePrivateKey', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose private key',
      properties: ['openFile'],
      filters: [
        { name: 'Private keys', extensions: ['pem', 'key', 'ppk'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('app:chooseUploadFiles', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose files to upload', properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('app:chooseDownloadPath', async (_event, defaultName: string) => {
    if (typeof defaultName !== 'string' || defaultName.length > 255) throw new Error('Download filename is invalid')
    const result = await dialog.showSaveDialog({ title: 'Save remote file', defaultPath: defaultName })
    return result.canceled ? null : result.filePath || null
  })
}
