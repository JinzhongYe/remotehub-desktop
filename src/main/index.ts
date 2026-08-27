import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { registerAppIpc } from './ipc/app.ipc'
import { registerConnectionIpc } from './ipc/connection.ipc'
import { StorageService } from './services/storage'
import { CredentialService } from './services/credentials'

let mainWindow: BrowserWindow | null = null
let storage: StorageService | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#11161d',
    title: 'RemoteHub',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged) {
    void mainWindow.loadURL('http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '..', '..', 'dist', 'index.html'))
  }
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  storage = new StorageService()
  registerAppIpc()
  registerConnectionIpc(storage, new CredentialService())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  storage?.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => storage?.close())
