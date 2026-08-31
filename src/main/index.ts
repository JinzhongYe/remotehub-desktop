import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { registerAppIpc } from './ipc/app.ipc'
import { registerConnectionIpc } from './ipc/connection.ipc'
import { registerSshIpc } from './ipc/ssh.ipc'
import { registerSftpIpc } from './ipc/sftp.ipc'
import { registerSerialIpc } from './ipc/serial.ipc'
import { registerDatabaseIpc } from './ipc/database.ipc'
import { StorageService } from './services/storage'
import { CredentialService } from './services/credentials'
import { SshService } from './services/ssh'
import { SftpService } from './services/sftp'
import { SerialService } from './services/serial'
import { DatabaseService } from './services/database'

let mainWindow: BrowserWindow | null = null
let storage: StorageService | null = null
let ssh: SshService | null = null
let sftp: SftpService | null = null
let serial: SerialService | null = null
let database: DatabaseService | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#000000',
    icon: join(__dirname, '..', '..', 'assets', 'remotehub.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#000000', symbolColor: '#f7f9fc', height: 48 } }),
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
  const credentials = new CredentialService()
  ssh = new SshService(storage, credentials, (channel, payload) => mainWindow?.webContents.send(channel, payload))
  sftp = new SftpService(storage, credentials, (channel, payload) => mainWindow?.webContents.send(channel, payload))
  serial = new SerialService(storage, (channel, payload) => mainWindow?.webContents.send(channel, payload))
  database = new DatabaseService(storage, credentials)
  registerAppIpc()
  registerConnectionIpc(storage, credentials, (path, baudRate) => serial!.test(path, baudRate), (connection) => database!.test(connection))
  registerSshIpc(storage, ssh)
  registerSftpIpc(storage, sftp)
  registerSerialIpc(storage, serial)
  registerDatabaseIpc(storage, database)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  storage?.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ssh?.dispose()
  sftp?.dispose()
  serial?.dispose()
  database?.dispose()
  storage?.close()
})
