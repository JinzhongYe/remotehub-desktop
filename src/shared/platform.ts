import type { CodexStatus } from './codex'
import type { SessionConnectionStatusEvent } from './connection-status'
import type {
  DatabaseCatalog,
  DatabaseColumn,
  DatabaseChangesRequest,
  DatabaseConnectResult,
  DatabaseCsvExport,
  DatabaseQueryRequest,
  DatabaseQueryResult,
  DatabaseSchemaSection,
  DatabaseTable,
  DatabaseTableDetails
} from './database'
import type { LocalDirectory } from './local-files'
import type { LocalShellDataEvent, LocalShellStatusEvent } from './local-shell'
import type { SerialDataEvent, SerialPortInfo, SerialStatusEvent } from './serial'
import type {
  SftpConnectResult,
  SftpEntry,
  SftpEntryType,
  SftpQueueResult,
  SftpTransferEvent,
  SftpTransferItem
} from './sftp'
import type { ServerStatus, SshConnectResult, SshDataEvent, SshExecResult, SshPasswordOptions, SshStatusEvent } from './ssh'
import type {
  AppInfo,
  Connection,
  ConnectionOrderItem,
  ConnectionSaveRequest,
  ConnectionTestRequest,
  ConnectionTestResult,
  Group
} from './types'

export type Unsubscribe = () => void
export type OperationResult = { ok: true }
export type ConnectionFileResult = { canceled: boolean; count: number }

export interface StorageProvider {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<OperationResult>
  remove(key: string): Promise<OperationResult>
}

export interface PlatformCapabilities {
  connectionManagement: boolean
  ssh: boolean
  sftp: boolean
  database: boolean
  databaseSqlite: boolean
  databaseSshTunnel: boolean
  ftp: boolean
  serial: boolean
  localShell: boolean
  localFiles: boolean
  sftpTransferControl: boolean
  codexStatus: boolean
}

export interface RemoteFileProvider {
  connect(connectionId: string, options?: SshPasswordOptions): Promise<SftpConnectResult>
  list(sessionId: string, path: string): Promise<SftpEntry[]>
  mkdir(sessionId: string, path: string): Promise<OperationResult>
  rename(sessionId: string, oldPath: string, newPath: string): Promise<OperationResult>
  readText(sessionId: string, path: string): Promise<{ content: string; modifiedAt: number }>
  writeText(sessionId: string, path: string, content: string, expectedModifiedAt: number): Promise<{ modifiedAt: number }>
  remove(sessionId: string, path: string, type: SftpEntryType): Promise<OperationResult>
  enqueueUploads(sessionId: string, localPaths: string[], remoteDirectory: string, overwrite?: boolean): Promise<SftpQueueResult>
  enqueueDownload(sessionId: string, remotePath: string, localDirectory: string, entryType: SftpEntryType, overwrite?: boolean): Promise<SftpQueueResult>
  listTransfers(sessionId: string): Promise<SftpTransferItem[]>
  pauseTransfer(sessionId: string, transferId: string): Promise<SftpTransferItem>
  resumeTransfer(sessionId: string, transferId: string): Promise<SftpTransferItem>
  cancelTransfer(sessionId: string, transferId: string): Promise<SftpTransferItem>
  retryTransfer(sessionId: string, transferId: string): Promise<SftpTransferItem>
  clearFinishedTransfers(sessionId: string): Promise<OperationResult>
  disconnect(sessionId: string): Promise<OperationResult>
  onStatus(listener: (event: SessionConnectionStatusEvent) => void): Unsubscribe
  onTransfer(listener: (event: SftpTransferEvent) => void): Unsubscribe
}

export interface RemoteHubPlatform {
  capabilities: PlatformCapabilities
  storage?: StorageProvider
  app: {
    getInfo(): Promise<AppInfo>
    copyText(text: string): Promise<OperationResult>
    readText(): Promise<string>
    setTheme(theme: 'dark' | 'light' | 'tokyo-night' | 'tokyo-storm' | 'tokyo-light'): Promise<OperationResult>
    listLocalDirectory(path?: string): Promise<LocalDirectory>
    choosePrivateKey(): Promise<string | null>
    chooseDatabaseFile(): Promise<string | null>
    chooseShellDirectory(): Promise<string | null>
    chooseUploadFiles(): Promise<string[]>
    chooseUploadFolder(): Promise<string | null>
    chooseDownloadPath(defaultName: string): Promise<string | null>
    chooseDownloadDirectory(): Promise<string | null>
    releaseFiles(paths: string[]): Promise<OperationResult>
    confirmClose(): Promise<OperationResult>
    onBackRequest(listener: () => void): Unsubscribe
    onCloseRequest(listener: () => void): Unsubscribe
    onFullscreenChange(listener: (fullscreen: boolean) => void): Unsubscribe
  }
  files?: {
    getPath(file: File): string
  }
  connections?: {
    list(): Promise<{ connections: Connection[]; groups: Group[] }>
    save(request: ConnectionSaveRequest): Promise<Connection>
    delete(id: string): Promise<OperationResult>
    duplicate(id: string): Promise<Connection>
    reorder(items: ConnectionOrderItem[]): Promise<Connection[]>
    export(): Promise<ConnectionFileResult>
    import(): Promise<ConnectionFileResult>
    test(target: string | ConnectionTestRequest): Promise<ConnectionTestResult>
  }
  ssh?: {
    connect(connectionId: string, options?: SshPasswordOptions, sessionId?: string): Promise<SshConnectResult>
    trustHostKey(connectionId: string, fingerprint: string): Promise<OperationResult>
    hasSessionCredential(connectionId: string): Promise<boolean>
    write(sessionId: string, data: string): Promise<OperationResult>
    acknowledgeOutput(sessionId: string, sequence: number): Promise<OperationResult>
    resize(sessionId: string, cols: number, rows: number): Promise<OperationResult>
    exec(sessionId: string, command: string): Promise<SshExecResult>
    statusOverview(sessionId: string): Promise<ServerStatus>
    codexStatus(sessionId: string): Promise<CodexStatus>
    disconnect(sessionId: string): Promise<OperationResult>
    onData(listener: (event: SshDataEvent) => void, sessionId: string): Unsubscribe
    onStatus(listener: (event: SshStatusEvent) => void): Unsubscribe
  }
  sftp?: RemoteFileProvider & {
    trustHostKey(connectionId: string, fingerprint: string): Promise<OperationResult>
  }
  ftp?: RemoteFileProvider
  serial?: {
    listPorts(): Promise<SerialPortInfo[]>
    connect(connectionId: string): Promise<{ sessionId: string }>
    write(sessionId: string, data: string): Promise<OperationResult>
    disconnect(sessionId: string): Promise<OperationResult>
    onData(listener: (event: SerialDataEvent) => void): Unsubscribe
    onStatus(listener: (event: SerialStatusEvent) => void): Unsubscribe
  }
  shell?: {
    connect(connectionId: string): Promise<{ sessionId: string }>
    write(sessionId: string, data: string): Promise<OperationResult>
    resize(sessionId: string, cols: number, rows: number): Promise<OperationResult>
    codexStatus(sessionId: string): Promise<CodexStatus>
    disconnect(sessionId: string): Promise<OperationResult>
    onData(listener: (event: LocalShellDataEvent) => void): Unsubscribe
    onStatus(listener: (event: LocalShellStatusEvent) => void): Unsubscribe
  }
  database?: {
    connect(connectionId: string): Promise<DatabaseConnectResult>
    listDatabases(sessionId: string): Promise<DatabaseCatalog[]>
    useDatabase(sessionId: string, name: string): Promise<{ database: string }>
    listTables(sessionId: string, name: string): Promise<DatabaseTable[]>
    listColumns(sessionId: string, name: string, table: string): Promise<DatabaseColumn[]>
    listTableDetails(sessionId: string, name: string, table: string, section: DatabaseSchemaSection): Promise<DatabaseTableDetails>
    query(sessionId: string, request: DatabaseQueryRequest): Promise<DatabaseQueryResult>
    applyChanges(sessionId: string, request: DatabaseChangesRequest): Promise<OperationResult>
    exportCsv(request: DatabaseCsvExport): Promise<string | null>
    disconnect(sessionId: string): Promise<OperationResult>
    onStatus(listener: (event: SessionConnectionStatusEvent) => void): Unsubscribe
  }
  groups?: {
    save(name: string, id?: string): Promise<Group>
    reorder(ids: string[]): Promise<Group[]>
    delete(id: string): Promise<OperationResult>
  }
}
