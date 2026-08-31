import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { lstat, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

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
  ipcMain.handle('app:readText', () => clipboard.readText().slice(0, 1024 * 1024))
  ipcMain.handle('app:setTheme', (event, theme: string) => {
    if (theme !== 'dark' && theme !== 'light') throw new Error('Theme is invalid')
    const window = BrowserWindow.fromWebContents(event.sender)
    const dark = theme === 'dark'
    window?.setBackgroundColor(dark ? '#000000' : '#edf1f5')
    if (process.platform !== 'darwin') window?.setTitleBarOverlay({ color: dark ? '#000000' : '#edf1f5', symbolColor: dark ? '#f7f9fc' : '#182230', height: 48 })
    return { ok: true }
  })
  ipcMain.handle('app:listLocalDirectory', async (_event, requestedPath?: string) => {
    const input = requestedPath || app.getPath('downloads')
    if (typeof input !== 'string' || input.length > 4096 || !isAbsolute(input)) throw new Error('Local directory path is invalid')
    const path = resolve(input)
    if (!(await stat(path)).isDirectory()) throw new Error('Local path is not a directory')
    const items = await readdir(path, { withFileTypes: true })
    // ponytail: cap huge folders at 5,000 rows; add pagination if real directories exceed it.
    const entries = (await Promise.all(items.slice(0, 5000).map(async (item) => {
      const itemPath = resolve(path, item.name)
      try {
        const details = await lstat(itemPath)
        return { name: item.name, path: itemPath, type: item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'link' : 'file', size: details.size, modifiedAt: details.mtimeMs }
      } catch { return null }
    }))).filter((item) => item !== null).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    const parentPath = dirname(path)
    return { path, parentPath: parentPath === path ? path : parentPath, entries }
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
  ipcMain.handle('app:chooseDatabaseFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose SQLite database',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('app:chooseShellDirectory', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose shell working directory', properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('app:chooseUploadFiles', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose files to upload', properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('app:chooseUploadFolder', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose folder to upload', properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('app:chooseDownloadPath', async (_event, defaultName: string) => {
    if (typeof defaultName !== 'string' || defaultName.length > 255) throw new Error('Download filename is invalid')
    const result = await dialog.showSaveDialog({ title: 'Save remote file', defaultPath: defaultName })
    return result.canceled ? null : result.filePath || null
  })
  ipcMain.handle('app:chooseDownloadDirectory', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose download folder', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })
}
