import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Connection, ConnectionInput, Group } from '../../../shared/types'
import type Database from 'better-sqlite3'

type BetterSqlite3 = typeof import('better-sqlite3')
const loadNativeModule = createRequire(__filename)

type ConnectionRow = {
  id: string
  name: string
  type: string
  host: string
  port: number
  username: string | null
  auth_type: string | null
  database_type: string | null
  database_name: string | null
  credential_id: string | null
  group_id: string | null
  favorite: number
  created_at: number
  updated_at: number
}

export class StorageService {
  private readonly db: Database.Database | null
  private readonly fallbackPath: string
  private fallbackData: FallbackData

  constructor() {
    const dbPath = join(app.getPath('userData'), 'remotehub.db')
    mkdirSync(dirname(dbPath), { recursive: true })
    this.fallbackPath = join(app.getPath('userData'), 'remotehub.metadata.json')
    this.fallbackData = loadFallback(this.fallbackPath)

    try {
      const BetterSqlite3Constructor = loadNativeModule('better-sqlite3') as BetterSqlite3
      const db = new BetterSqlite3Constructor(dbPath)
      db.pragma('journal_mode = WAL')
      db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('ssh', 'database')),
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        auth_type TEXT,
        database_type TEXT,
        database_name TEXT,
        credential_id TEXT,
        group_id TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_id);
      CREATE INDEX IF NOT EXISTS idx_connections_updated ON connections(updated_at DESC);
      `)
      this.db = db
    } catch {
      // Native modules can be unavailable immediately after a dependency install.
      // Keep the Phase 0 shell usable with a metadata-only local fallback; the
      // normal path remains SQLite as soon as better-sqlite3 is available.
      this.db = null
    }
  }

  listConnections(): Connection[] {
    if (!this.db) return [...this.fallbackData.connections]
    const rows = this.db.prepare('SELECT * FROM connections ORDER BY favorite DESC, updated_at DESC, name COLLATE NOCASE').all() as ConnectionRow[]
    return rows.map(toConnection)
  }

  listGroups(): Group[] {
    if (!this.db) return [...this.fallbackData.groups]
    return this.db.prepare('SELECT id, name, sort_order AS sortOrder FROM groups ORDER BY sort_order, name COLLATE NOCASE').all() as Group[]
  }

  saveConnection(input: ConnectionInput): Connection {
    const normalized = normalizeConnection(input)
    const now = Date.now()
    const existingCreatedAt = input.id
      ? this.db
        ? (this.db.prepare('SELECT created_at FROM connections WHERE id = ?').get(input.id) as { created_at: number } | undefined)?.created_at
        : this.fallbackData.connections.find((item) => item.id === input.id)?.createdAt
      : undefined
    const connection: Connection = {
      ...normalized,
      id: input.id || randomUUID(),
      createdAt: existingCreatedAt ?? now,
      updatedAt: now,
      favorite: Boolean(input.favorite)
    }
    if (!this.db) {
      const index = this.fallbackData.connections.findIndex((item) => item.id === connection.id)
      if (index >= 0) this.fallbackData.connections[index] = connection
      else this.fallbackData.connections.push(connection)
      persistFallback(this.fallbackPath, this.fallbackData)
      return connection
    }
    this.db.prepare(`
      INSERT INTO connections (
        id, name, type, host, port, username, auth_type, database_type,
        database_name, credential_id, group_id, favorite, created_at, updated_at
      ) VALUES (@id, @name, @type, @host, @port, @username, @authType, @databaseType,
        @database, @credentialId, @groupId, @favorite, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        host = excluded.host,
        port = excluded.port,
        username = excluded.username,
        auth_type = excluded.auth_type,
        database_type = excluded.database_type,
        database_name = excluded.database_name,
        credential_id = excluded.credential_id,
        group_id = excluded.group_id,
        favorite = excluded.favorite,
        updated_at = excluded.updated_at
    `).run({ ...connection, favorite: connection.favorite ? 1 : 0, authType: connection.authType || null, databaseType: connection.databaseType || null, database: connection.database || null, credentialId: connection.credentialId || null, groupId: connection.groupId || null })
    return connection
  }

  deleteConnection(id: string): void {
    if (!id || id.length > 100) throw appError('INVALID_CONNECTION_ID', '连接标识无效')
    if (!this.db) {
      this.fallbackData.connections = this.fallbackData.connections.filter((item) => item.id !== id)
      persistFallback(this.fallbackPath, this.fallbackData)
      return
    }
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id)
  }

  close(): void {
    this.db?.close()
  }
}

type FallbackData = {
  connections: Connection[]
  groups: Group[]
}

function loadFallback(path: string): FallbackData {
  if (!existsSync(path)) return { connections: [], groups: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FallbackData>
    return {
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : []
    }
  } catch {
    return { connections: [], groups: [] }
  }
}

function persistFallback(path: string, data: FallbackData): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

function normalizeConnection(input: ConnectionInput): Omit<Connection, 'id' | 'createdAt' | 'updatedAt'> {
  const name = String(input.name || '').trim()
  const host = String(input.host || '').trim()
  if (!name || !host) throw appError('INVALID_CONNECTION', '连接名称和主机地址不能为空')
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw appError('INVALID_PORT', '端口必须是1到65535之间的整数')
  return {
    name: name.slice(0, 120),
    type: input.type === 'database' ? 'database' : 'ssh',
    host: host.slice(0, 255),
    port,
    username: input.username?.trim().slice(0, 120) || undefined,
    authType: input.authType === 'privateKey' ? 'privateKey' : input.authType === 'password' ? 'password' : undefined,
    databaseType: ['mysql', 'postgres', 'sqlite'].includes(input.databaseType || '') ? input.databaseType : undefined,
    database: input.database?.trim().slice(0, 200) || undefined,
    credentialId: input.credentialId?.trim().slice(0, 160) || undefined,
    groupId: input.groupId?.trim().slice(0, 100) || undefined,
    favorite: Boolean(input.favorite)
  }
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Connection['type'],
    host: row.host,
    port: row.port,
    username: row.username || undefined,
    authType: row.auth_type as Connection['authType'],
    databaseType: row.database_type as Connection['databaseType'],
    database: row.database_name || undefined,
    credentialId: row.credential_id || undefined,
    groupId: row.group_id || undefined,
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function appError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
  const error = new Error(message) as Error & { code: string; details?: unknown }
  error.code = code
  error.details = details
  return error
}
