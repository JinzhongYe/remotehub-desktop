import type { SerialOptions } from './serial'

export type ConnectionType = 'ssh' | 'ftp' | 'database' | 'serial' | 'shell'
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite'
export type DatabaseSslMode = 'disable' | 'require' | 'verify-full'
export type AuthType = 'password' | 'privateKey'

export interface Connection {
  id: string
  name: string
  notes?: string
  color?: string
  initialCommand?: string
  serialOptions?: SerialOptions
  type: ConnectionType
  host: string
  port: number
  username?: string
  authType?: AuthType
  databaseType?: DatabaseType
  database?: string
  databaseSslMode?: DatabaseSslMode
  sshTunnelId?: string
  credentialId?: string
  hostKeyFingerprint?: string
  groupId?: string
  favorite: boolean
  sortOrder: number
  lastConnectedAt?: number
  createdAt: number
  updatedAt: number
}

export interface ConnectionInput {
  id?: string
  name: string
  notes?: string
  color?: string
  initialCommand?: string
  serialOptions?: SerialOptions
  type: ConnectionType
  host: string
  port: number
  username?: string
  authType?: AuthType
  databaseType?: DatabaseType
  database?: string
  databaseSslMode?: DatabaseSslMode
  sshTunnelId?: string
  credentialId?: string
  groupId?: string
  favorite?: boolean
  sortOrder?: number
}

export interface Group {
  id: string
  name: string
  sortOrder: number
}

export interface ConnectionSaveRequest {
  connection: ConnectionInput
  credential?: string
  privateKeyPath?: string
  clearCredential?: boolean
}

export interface ConnectionOrderItem {
  id: string
  groupId?: string
}

export interface ConnectionTestResult {
  ok: boolean
  code: 'OK' | 'CONNECTION_TIMEOUT' | 'CONNECTION_REFUSED' | 'HOST_NOT_FOUND' | 'NETWORK_UNREACHABLE' | 'CONNECTION_FAILED' | 'AUTHENTICATION_FAILED' | 'DATABASE_NOT_FOUND' | 'DATABASE_FAILED'
  message: string
  latencyMs: number
  testedAt: number
}

export interface ConnectionTestRequest {
  connection: ConnectionInput
  credential?: string
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  dataPath: string
}

export interface AppError {
  code: string
  message: string
  details?: unknown
}
