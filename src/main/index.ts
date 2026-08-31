import { app, BrowserWindow, dialog, session } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
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

// Preserve the existing development profile when productName is introduced.
app.setPath('userData', join(app.getPath('appData'), 'remotehub-desktop'))
const smokeDirectory = app.commandLine.hasSwitch('smoke-test') ? process.env.REMOTEHUB_SMOKE_DIR : undefined
if (smokeDirectory) {
  mkdirSync(join(smokeDirectory, 'profile'), { recursive: true })
  app.setPath('userData', join(smokeDirectory, 'profile'))
}

let mainWindow: BrowserWindow | null = null
let storage: StorageService | null = null
let ssh: SshService | null = null
let sftp: SftpService | null = null
let serial: SerialService | null = null
let database: DatabaseService | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    show: !smokeDirectory,
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
  if (!app.isPackaged && app.commandLine.hasSwitch('dev')) {
    await mainWindow.loadURL('http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(join(__dirname, '..', '..', 'dist', 'index.html'))
  }
  mainWindow.on('closed', () => { mainWindow = null })
  if (smokeDirectory) {
    const { runPackagedSmokeTest } = await import('./smoke-test')
    const report = await runPackagedSmokeTest(mainWindow, smokeDirectory)
    writeFileSync(join(smokeDirectory, 'result.json'), JSON.stringify(report, null, 2))
    app.quit()
  }
}

app.whenReady().then(async () => {
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
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(startupFailure) })
}).catch(startupFailure)

function startupFailure(error: unknown): void {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  if (smokeDirectory) writeFileSync(join(smokeDirectory, 'result.json'), JSON.stringify({ ok: false, error: message }))
  else dialog.showErrorBox('RemoteHub could not start', message)
  app.exit(1)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ssh?.dispose()
  sftp?.dispose()
  serial?.dispose()
  database?.dispose()
  storage?.close()
})
