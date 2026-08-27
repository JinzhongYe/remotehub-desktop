import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Connection, ConnectionInput, ConnectionOrderItem, Group } from '../../../shared/types'
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
  host_key_fingerprint: string | null
  group_id: string | null
  favorite: number
  sort_order: number
  last_connected_at: number | null
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
      db.pragma('foreign_keys = ON')
      db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('ssh', 'database', 'serial')),
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        auth_type TEXT,
        database_type TEXT,
        database_name TEXT,
        credential_id TEXT,
        host_key_fingerprint TEXT,
        group_id TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        last_connected_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_id);
      CREATE INDEX IF NOT EXISTS idx_connections_updated ON connections(updated_at DESC);
      `)
      ensureColumn(db, 'connections', 'sort_order', 'INTEGER NOT NULL DEFAULT 0')
      ensureColumn(db, 'connections', 'last_connected_at', 'INTEGER')
      ensureColumn(db, 'connections', 'host_key_fingerprint', 'TEXT')
      migrateConnectionTypes(db)
      this.db = db
    } catch {
      // Native modules can be unavailable immediately after a dependency install.
      // Keep the Phase 0 shell usable with a metadata-only local fallback; the
      // normal path remains SQLite as soon as better-sqlite3 is available.
      this.db = null
    }
  }

  listConnections(): Connection[] {
    if (!this.db) return this.fallbackData.connections.map((item, index) => ({ ...item, sortOrder: item.sortOrder ?? index })).sort((a, b) => a.sortOrder - b.sortOrder)
    const rows = this.db.prepare('SELECT * FROM connections ORDER BY sort_order, name COLLATE NOCASE').all() as ConnectionRow[]
    return rows.map(toConnection)
  }

  listGroups(): Group[] {
    if (!this.db) return [...this.fallbackData.groups]
    return this.db.prepare('SELECT id, name, sort_order AS sortOrder FROM groups ORDER BY sort_order, name COLLATE NOCASE').all() as Group[]
  }

  saveConnection(input: ConnectionInput): Connection {
    this.validateConnection(input)
    const normalized = normalizeConnection(input)
    const now = Date.now()
    const previous = input.id ? this.getConnection(input.id) : undefined
    const connection: Connection = {
      ...normalized,
      id: input.id || randomUUID(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      favorite: Boolean(input.favorite),
      sortOrder: input.sortOrder ?? this.nextConnectionOrder(),
      lastConnectedAt: previous?.lastConnectedAt,
      hostKeyFingerprint: normalized.type === 'ssh' && previous?.type === 'ssh' && previous.host === normalized.host && previous.port === normalized.port ? previous.hostKeyFingerprint : undefined
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
        database_name, credential_id, host_key_fingerprint, group_id, favorite, sort_order, last_connected_at, created_at, updated_at
      ) VALUES (@id, @name, @type, @host, @port, @username, @authType, @databaseType,
        @database, @credentialId, @hostKeyFingerprint, @groupId, @favorite, @sortOrder, @lastConnectedAt, @createdAt, @updatedAt)
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
        host_key_fingerprint = excluded.host_key_fingerprint,
        group_id = excluded.group_id,
        favorite = excluded.favorite,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run({ ...connection, favorite: connection.favorite ? 1 : 0, authType: connection.authType || null, databaseType: connection.databaseType || null, database: connection.database || null, credentialId: connection.credentialId || null, hostKeyFingerprint: connection.hostKeyFingerprint || null, groupId: connection.groupId || null, lastConnectedAt: connection.lastConnectedAt || null })
    return connection
  }

  getConnection(id: string): Connection | undefined {
    if (typeof id !== 'string' || !id || id.length > 100) return undefined
    if (!this.db) return this.fallbackData.connections.find((item) => item.id === id)
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow | undefined
    return row ? toConnection(row) : undefined
  }

  duplicateConnection(id: string): Connection {
    const source = this.getConnection(id)
    if (!source) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    return this.saveConnection({ ...source, id: undefined, credentialId: undefined, name: `${source.name} Copy`, sortOrder: this.nextConnectionOrder() })
  }

  reorderConnections(items: ConnectionOrderItem[]): Connection[] {
    if (!Array.isArray(items) || new Set(items.map((item) => item.id)).size !== items.length) throw appError('INVALID_ORDER', 'Connection order is invalid')
    const ids = new Set(this.listConnections().map((item) => item.id))
    if (items.length !== ids.size || items.some((item) => !ids.has(item.id))) throw appError('INVALID_ORDER', 'Connection order is incomplete')
    if (!this.db) {
      const byId = new Map(this.fallbackData.connections.map((item) => [item.id, item]))
      this.fallbackData.connections = items.map((item, sortOrder) => ({ ...byId.get(item.id)!, groupId: item.groupId, sortOrder }))
      persistFallback(this.fallbackPath, this.fallbackData)
      return this.listConnections()
    }
    const update = this.db.prepare('UPDATE connections SET sort_order = ?, group_id = ? WHERE id = ?')
    this.db.transaction(() => items.forEach((item, sortOrder) => update.run(sortOrder, item.groupId || null, item.id)))()
    return this.listConnections()
  }

  markConnected(id: string, timestamp: number): void {
    if (!this.getConnection(id)) throw appError('CONNECTION_NOT_FOUND', 'Connection not found')
    if (!this.db) {
      const item = this.fallbackData.connections.find((connection) => connection.id === id)!
      item.lastConnectedAt = timestamp
      persistFallback(this.fallbackPath, this.fallbackData)
      return
    }
    this.db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(timestamp, id)
  }

  trustHostKey(id: string, fingerprint: string): void {
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) throw appError('SSH_HOST_KEY_INVALID', 'Host key fingerprint is invalid')
    const connection = this.getConnection(id)
    if (!connection || connection.type !== 'ssh') throw appError('CONNECTION_NOT_FOUND', 'SSH connection not found')
    const updatedAt = Date.now()
    if (!this.db) {
      connection.hostKeyFingerprint = fingerprint
      connection.updatedAt = updatedAt
      persistFallback(this.fallbackPath, this.fallbackData)
      return
    }
    this.db.prepare('UPDATE connections SET host_key_fingerprint = ?, updated_at = ? WHERE id = ?').run(fingerprint, updatedAt, id)
  }

  saveGroup(nameInput: string, id?: string): Group {
    const name = String(nameInput || '').trim().slice(0, 80)
    if (!name) throw appError('INVALID_GROUP', 'Group name cannot be empty')
    if (id && (typeof id !== 'string' || id.length > 100)) throw appError('INVALID_GROUP', 'Group identifier is invalid')
    const group: Group = { id: id || randomUUID(), name, sortOrder: id ? this.listGroups().find((item) => item.id === id)?.sortOrder ?? this.listGroups().length : this.listGroups().length }
    if (!this.db) {
      const index = this.fallbackData.groups.findIndex((item) => item.id === group.id)
      if (index >= 0) this.fallbackData.groups[index] = group
      else this.fallbackData.groups.push(group)
      persistFallback(this.fallbackPath, this.fallbackData)
      return group
    }
    this.db.prepare('INSERT INTO groups (id, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name').run(group.id, group.name, group.sortOrder)
    return group
  }

  deleteGroup(id: string): void {
    if (!id || id.length > 100) throw appError('INVALID_GROUP', 'Group identifier is invalid')
    if (!this.db) {
      this.fallbackData.groups = this.fallbackData.groups.filter((item) => item.id !== id)
      this.fallbackData.connections.forEach((item) => { if (item.groupId === id) item.groupId = undefined })
      persistFallback(this.fallbackPath, this.fallbackData)
      return
    }
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id)
  }

  hasCredentialReference(id: string): boolean {
    return this.listConnections().some((item) => item.credentialId === id)
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

  validateConnection(input: ConnectionInput): void {
    const normalized = normalizeConnection(input)
    if (input.id && (typeof input.id !== 'string' || input.id.length > 100)) throw appError('INVALID_CONNECTION_ID', 'Connection identifier is invalid')
    if (normalized.groupId && !this.listGroups().some((group) => group.id === normalized.groupId)) throw appError('GROUP_NOT_FOUND', 'Group not found')
  }

  private nextConnectionOrder(): number {
    return this.listConnections().reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1
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

function normalizeConnection(input: ConnectionInput): Omit<Connection, 'id' | 'createdAt' | 'updatedAt' | 'hostKeyFingerprint'> {
  const name = String(input.name || '').trim()
  const host = String(input.host || '').trim()
  if (!name || !host) throw appError('INVALID_CONNECTION', '连接名称和主机/串口地址不能为空')
  const port = Number(input.port)
  if (input.type !== 'ssh' && input.type !== 'database' && input.type !== 'serial') throw appError('INVALID_CONNECTION_TYPE', 'Connection type is invalid')
  const maximumPort = input.type === 'serial' ? 4_000_000 : 65535
  if (!Number.isInteger(port) || port < 1 || port > maximumPort) throw appError('INVALID_PORT', input.type === 'serial' ? '波特率必须是1到4000000之间的整数' : '端口必须是1到65535之间的整数')
  const type = input.type
  return {
    name: name.slice(0, 120),
    type,
    host: host.slice(0, 255),
    port,
    username: type === 'serial' ? undefined : String(input.username || '').trim().slice(0, 120) || undefined,
    authType: type === 'serial' ? undefined : input.authType === 'privateKey' ? 'privateKey' : input.authType === 'password' ? 'password' : undefined,
    databaseType: type === 'database' && ['mysql', 'postgres', 'sqlite'].includes(input.databaseType || '') ? input.databaseType : undefined,
    database: type === 'database' ? String(input.database || '').trim().slice(0, 200) || undefined : undefined,
    credentialId: type === 'serial' ? undefined : String(input.credentialId || '').trim().slice(0, 160) || undefined,
    groupId: String(input.groupId || '').trim().slice(0, 100) || undefined,
    favorite: Boolean(input.favorite),
    sortOrder: Number.isInteger(input.sortOrder) && Number(input.sortOrder) >= 0 ? Number(input.sortOrder) : 0
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
    hostKeyFingerprint: row.host_key_fingerprint || undefined,
    groupId: row.group_id || undefined,
    favorite: Boolean(row.favorite),
    sortOrder: row.sort_order,
    lastConnectedAt: row.last_connected_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function migrateConnectionTypes(db: Database.Database): void {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'connections'").get() as { sql?: string } | undefined
  if (table?.sql?.includes("'serial'")) return
  db.pragma('foreign_keys = OFF')
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE connections_next (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('ssh', 'database', 'serial')),
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        auth_type TEXT,
        database_type TEXT,
        database_name TEXT,
        credential_id TEXT,
        host_key_fingerprint TEXT,
        group_id TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        last_connected_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
      );
      INSERT INTO connections_next SELECT id, name, type, host, port, username, auth_type, database_type, database_name, credential_id, host_key_fingerprint, group_id, favorite, sort_order, last_connected_at, created_at, updated_at FROM connections;
      DROP TABLE connections;
      ALTER TABLE connections_next RENAME TO connections;
      CREATE INDEX idx_connections_group ON connections(group_id);
      CREATE INDEX idx_connections_updated ON connections(updated_at DESC);
      COMMIT;
    `)
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* best effort */ }
    throw error
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

export function appError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
  const error = new Error(message) as Error & { code: string; details?: unknown }
  error.code = code
  error.details = details
  return error
}
