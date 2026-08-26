export type ConnectionType = 'ssh' | 'database'
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite'
export type AuthType = 'password' | 'privateKey'

export interface Connection {
  id: string
  name: string
  type: ConnectionType
  host: string
  port: number
  username?: string
  authType?: AuthType
  databaseType?: DatabaseType
  database?: string
  credentialId?: string
  groupId?: string
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface ConnectionInput {
  id?: string
  name: string
  type: ConnectionType
  host: string
  port: number
  username?: string
  authType?: AuthType
  databaseType?: DatabaseType
  database?: string
  credentialId?: string
  groupId?: string
  favorite?: boolean
}

export interface Group {
  id: string
  name: string
  sortOrder: number
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
