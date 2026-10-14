import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { open, save } from '@tauri-apps/plugin-dialog'
import packageJson from '../../package.json'
import type { OperationResult, RemoteHubPlatform, Unsubscribe } from '../shared/platform'
import type { SessionConnectionStatusEvent } from '../shared/connection-status'
import { databaseResultToCsv } from '../shared/database'
import type { SftpTransferEvent } from '../shared/sftp'
import { parseServerStatus, SERVER_STATUS_COMMAND, type SshDataEvent, type SshStatusEvent } from '../shared/ssh'

const ios = import.meta.env.TAURI_ENV_PLATFORM === 'ios'
const ok = (): OperationResult => ({ ok: true })
const noListener = (): Unsubscribe => () => undefined

function unsupported<T>(name: string): Promise<T> {
  return Promise.reject(new Error(`${name} is not supported on this mobile platform yet`))
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (source) {
    const value = source as { code?: string; message?: string }
    const error = new Error(value?.message || String(source)) as Error & { code?: string }
    error.code = value?.code
    throw error
  }
}

function eventBridge<T>(name: string): (listener: (event: T) => void) => Unsubscribe {
  const listeners = new Set<(event: T) => void>()
  let unlisten: Promise<UnlistenFn> | undefined
  return (listener) => {
    listeners.add(listener)
    unlisten ||= listen<T>(name, ({ payload }) => listeners.forEach((current) => current(payload)))
    return () => listeners.delete(listener)
  }
}

function onBackRequest(listener: () => void): Unsubscribe {
  if (ios) return noListener()
  let active = true
  const subscription = onBackButtonPress(() => { if (active) listener() })
  return () => {
    active = false
    void subscription.then((current) => current.unregister()).catch(() => undefined)
  }
}

const sshListeners = new Map<string, Set<(event: SshDataEvent) => void>>()
let sshSubscription: Promise<UnlistenFn> | undefined
function onSshData(listener: (event: SshDataEvent) => void, sessionId: string): Unsubscribe {
  const listeners = sshListeners.get(sessionId) || new Set()
  listeners.add(listener)
  sshListeners.set(sessionId, listeners)
  // Install the native listener before connecting; one bridge routes to the owning pane.
  sshSubscription ||= listen<SshDataEvent>('ssh:data', ({ payload }) => {
    sshListeners.get(payload.sessionId)?.forEach(current => current(payload))
  })
  return () => {
    listeners.delete(listener)
    if (!listeners.size) sshListeners.delete(sessionId)
  }
}
const onSshStatus = eventBridge<SshStatusEvent>('ssh:status')
const onSftpStatus = eventBridge<SessionConnectionStatusEvent>('sftp:status')
const onSftpTransfer = eventBridge<SftpTransferEvent>('sftp:transfer')
const onDatabaseStatus = eventBridge<SessionConnectionStatusEvent>('database:status')

const platform: RemoteHubPlatform = {
  capabilities: {
    connectionManagement: true,
    ssh: true,
    sftp: true,
    database: true,
    databaseSqlite: false,
    databaseSshTunnel: false,
    ftp: false,
    serial: false,
    localShell: false,
    localFiles: false,
    sftpTransferControl: false,
    codexStatus: false
  },
  storage: {
    get: async (key) => {
      const value = await call<string | null>('storage_get', { key })
      if (value !== null) return value
      const legacy = localStorage.getItem(key)
      if (legacy !== null) {
        await call('storage_set', { key, value: legacy })
        localStorage.removeItem(key)
      }
      return legacy
    },
    set: (key, value) => call('storage_set', { key, value }),
    remove: async (key) => {
      const result = await call<OperationResult>('storage_remove', { key })
      localStorage.removeItem(key)
      return result
    }
  },
  app: {
    getInfo: async () => ({ name: 'RemoteHub', version: packageJson.version, platform: ios ? 'ios' : 'android', dataPath: '' }),
    copyText: (text: string) => call('app_copy_text', { text }),
    readText: () => call('app_read_text'),
    setTheme: async () => ok(),
    listLocalDirectory: () => unsupported('Local files'),
    choosePrivateKey: () => unsupported('Private key selection'),
    chooseDatabaseFile: () => unsupported('Database file selection'),
    chooseShellDirectory: () => unsupported('Shell directory selection'),
    chooseUploadFiles: async () => {
      const selected = await open({ multiple: true, directory: false, pickerMode: 'document', fileAccessMode: 'copy' })
      const uris = selected ? Array.isArray(selected) ? selected : [selected] : []
      return uris.length ? call('app_prepare_upload_files', { uris }) : []
    },
    chooseUploadFolder: () => unsupported('Upload folder selection'),
    chooseDownloadPath: (defaultName) => ios ? call('app_download_path', { name: defaultName }) : save({ defaultPath: defaultName }),
    chooseDownloadDirectory: () => unsupported('Download directory selection'),
    releaseFiles: (paths) => call('app_release_files', { paths }),
    confirmClose: async () => ok(),
    onBackRequest,
    onCloseRequest: noListener,
    onFullscreenChange: noListener
  },
  connections: {
    list: () => call('connections_list'),
    save: (request) => call('connections_save', { request }),
    delete: (id) => call('connections_delete', { id }),
    duplicate: (id) => call('connections_duplicate', { id }),
    reorder: (items) => call('connections_reorder', { items }),
    export: () => unsupported('Connection export'),
    import: () => unsupported('Connection import'),
    test: (target) => call('connections_test', { target })
  },
  groups: {
    save: (name, id) => call('groups_save', { name, id }),
    reorder: (ids) => call('groups_reorder', { ids }),
    delete: (id) => call('groups_delete', { id })
  },
  ssh: {
    connect: async (connectionId, options, sessionId) => {
      if (sshSubscription) await sshSubscription
      return call('ssh_connect', { connectionId, options, sessionId })
    },
    trustHostKey: (connectionId, fingerprint) => call('ssh_trust_host_key', { connectionId, fingerprint }),
    hasSessionCredential: (connectionId) => call('ssh_has_session_credential', { connectionId }),
    write: (sessionId, data) => call('ssh_write', { sessionId, data }),
    acknowledgeOutput: (sessionId, sequence) => call('ssh_acknowledge_output', { sessionId, sequence }),
    resize: (sessionId, cols, rows) => call('ssh_resize', { sessionId, cols, rows }),
    exec: (sessionId, command) => call('ssh_exec', { sessionId, command }),
    statusOverview: async (sessionId) => {
      const result = await call<{ stdout: string; stderr: string; exitCode: number }>('ssh_exec', { sessionId, command: SERVER_STATUS_COMMAND })
      if (result.exitCode && !result.stdout) throw new Error(result.stderr.trim() || 'Could not read server status')
      return parseServerStatus(result.stdout)
    },
    codexStatus: () => unsupported('Codex status'),
    disconnect: (sessionId) => call('ssh_disconnect', { sessionId }),
    onData: onSshData,
    onStatus: onSshStatus
  },
  sftp: {
    connect: (connectionId, options) => call('sftp_connect', { connectionId, options }),
    trustHostKey: (connectionId, fingerprint) => call('ssh_trust_host_key', { connectionId, fingerprint }),
    list: (sessionId, path) => call('sftp_list', { sessionId, path }),
    mkdir: (sessionId, path) => call('sftp_mkdir', { sessionId, path }),
    rename: (sessionId, oldPath, newPath) => call('sftp_rename', { sessionId, oldPath, newPath }),
    readText: (sessionId, path) => call('sftp_read_text', { sessionId, path }),
    writeText: (sessionId, path, content, expectedModifiedAt) => call('sftp_write_text', { sessionId, path, content, expectedModifiedAt }),
    remove: (sessionId, path, entryType) => call('sftp_remove', { sessionId, path, entryType }),
    enqueueUploads: (sessionId, localPaths, remoteDirectory, overwrite = false) => call('sftp_enqueue_uploads', { sessionId, localPaths, remoteDirectory, overwrite }),
    enqueueDownload: (sessionId, remotePath, localTarget, entryType) => call('sftp_download', { sessionId, remotePath, localTarget, entryType }),
    listTransfers: (sessionId) => call('sftp_list_transfers', { sessionId }),
    pauseTransfer: () => unsupported('Transfer pause'),
    resumeTransfer: () => unsupported('Transfer resume'),
    cancelTransfer: () => unsupported('Transfer cancellation'),
    retryTransfer: () => unsupported('Transfer retry'),
    clearFinishedTransfers: (sessionId) => call('sftp_clear_finished_transfers', { sessionId }),
    disconnect: (sessionId) => call('sftp_disconnect', { sessionId }),
    onStatus: onSftpStatus,
    onTransfer: onSftpTransfer
  },
  database: {
    connect: (connectionId) => call('database_connect', { connectionId }),
    listDatabases: (sessionId) => call('database_list_databases', { sessionId }),
    useDatabase: (sessionId, name) => call('database_use_database', { sessionId, name }),
    listTables: (sessionId, name) => call('database_list_tables', { sessionId, name }),
    listColumns: (sessionId, name, table) => call('database_list_columns', { sessionId, name, table }),
    listTableDetails: (sessionId, name, table, section) => call('database_list_table_details', { sessionId, name, table, section }),
    query: (sessionId, request) => call('database_query', { sessionId, request }),
    applyChanges: (sessionId, request) => call('database_apply_changes', { sessionId, request }),
    exportCsv: async (request) => {
      const target = ios ? await call<string>('app_download_path', { name: request.fileName }) : await save({ defaultPath: request.fileName })
      if (!target) return null
      const result = await call<{ canceled?: boolean }>('database_export_csv', { target, csv: databaseResultToCsv(request) })
      return result.canceled ? null : target
    },
    disconnect: (sessionId) => call('database_disconnect', { sessionId }),
    onStatus: onDatabaseStatus
  }
}

export function getTauriPlatform(): RemoteHubPlatform {
  return platform
}
