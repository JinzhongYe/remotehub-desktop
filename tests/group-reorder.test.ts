import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageService } from '../src/main/services/storage'
import { useConnectionStore } from '../src/renderer/stores/connection'
import type { Connection, Group } from '../src/shared/types'

const fixtures = vi.hoisted(() => ({ data: '', fallback: true, failAtOrder: -1, failWrite: false }))
vi.mock('electron', () => ({ app: { getPath: () => fixtures.data } }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (fixtures.failWrite) throw new Error('Disk write failed')
      return actual.writeFileSync(...args)
    }
  }
})
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  const { DatabaseSync } = actual.createRequire(__filename)('node:sqlite') as typeof import('node:sqlite')
  // Exercise the production SQL against SQLite even when the Electron native binary
  // cannot load in the Node test runner. The adapter only translates its API surface.
  class TestDatabase {
    private database: InstanceType<typeof DatabaseSync>
    constructor(path: string) { this.database = new DatabaseSync(path) }
    pragma(value: string) { this.database.exec(`PRAGMA ${value}`) }
    exec(sql: string) { this.database.exec(sql) }
    prepare(sql: string) {
      const statement = this.database.prepare(sql)
      return {
        all: statement.all.bind(statement),
        get: statement.get.bind(statement),
        run: (...args: Parameters<typeof statement.run>) => {
          if (sql.startsWith('UPDATE groups') && args[0] === fixtures.failAtOrder) throw new Error('Update failed')
          if (args.length === 1 && args[0] && typeof args[0] === 'object' && !ArrayBuffer.isView(args[0])) return statement.run(Object.fromEntries(Object.entries(args[0]).map(([key, value]) => [key, value ?? null])))
          return statement.run(...args)
        }
      }
    }
    transaction(operation: () => void) {
      return () => {
        this.database.exec('BEGIN')
        try { operation(); this.database.exec('COMMIT') }
        catch (error) { this.database.exec('ROLLBACK'); throw error }
      }
    }
    close() { this.database.close() }
  }
  return {
    ...actual,
    createRequire: (filename: string) => {
      const require = actual.createRequire(filename)
      return (id: string) => {
        if (id !== 'better-sqlite3') return require(id)
        if (fixtures.fallback) throw new Error('Native module unavailable')
        return TestDatabase
      }
    }
  }
})

let storage: StorageService | undefined
afterEach(() => {
  fixtures.failWrite = false
  fixtures.failAtOrder = -1
  storage?.close()
  storage = undefined
  if (fixtures.data && dirname(resolve(fixtures.data)) === resolve(tmpdir())) rmSync(fixtures.data, { recursive: true, force: true })
  fixtures.data = ''
  vi.unstubAllGlobals()
})

function initialGroups(): Group[] {
  return ['a', 'b', 'c'].map((id, sortOrder) => ({ id, name: id.toUpperCase(), sortOrder }))
}

describe.each(['sqlite', 'json'] as const)('group ordering in %s storage', backend => {
  beforeEach(() => {
    fixtures.data = mkdtempSync(join(tmpdir(), 'remotehub-group-reorder-'))
    fixtures.fallback = backend === 'json'
    storage = new StorageService()
  })

  it('persists complete group order across restart without changing any connections', () => {
    for (const group of initialGroups()) storage!.saveGroup(group.name, group.id)
    for (const groupId of ['a', 'b', 'c', undefined]) storage!.saveConnection({ name: `Server ${groupId}`, type: 'ssh', host: 'localhost', port: 22, groupId })
    const connections = storage!.listConnections()
    expect(storage!.reorderGroups(['c', 'a', 'b']).map(group => [group.id, group.sortOrder])).toEqual([['c', 0], ['a', 1], ['b', 2]])
    expect(storage!.listConnections()).toEqual(connections)
    expect(existsSync(join(fixtures.data, backend === 'sqlite' ? 'remotehub.db' : 'remotehub.metadata.json'))).toBe(true)
    if (backend === 'sqlite') expect(existsSync(join(fixtures.data, 'remotehub.metadata.json'))).toBe(false)
    storage!.close()
    storage = new StorageService()
    expect(storage.listGroups().map(group => group.id)).toEqual(['c', 'a', 'b'])
    expect(storage.listConnections()).toEqual(connections)
    storage.saveGroup('Renamed A', 'a')
    expect(storage.listGroups().map(group => group.id)).toEqual(['c', 'a', 'b'])
  })

  it('rejects missing, duplicate, unknown, malformed and sparse ID lists without mutations', () => {
    for (const group of initialGroups()) storage!.saveGroup(group.name, group.id)
    const before = storage!.listGroups()
    const invalid: unknown[] = [null, undefined, {}, 'a', [], ['a', 'b'], ['a', 'b', 'b'], ['a', 'b', 'unknown'], ['a', 'b', ''], ['a', 'b', 7], ['a', 'b', null], ['a', 'b', 'x'.repeat(101)], new Array(3)]
    for (const ids of invalid) {
      expect(() => storage!.reorderGroups(ids as string[])).toThrowError(expect.objectContaining({ code: 'INVALID_ORDER' }))
      expect(storage!.listGroups()).toEqual(before)
    }
  })

  it('accepts the exact empty set when no groups exist', () => {
    expect(storage!.reorderGroups([])).toEqual([])
  })

  it('leaves the previous order intact if persistence fails', () => {
    for (const group of initialGroups()) storage!.saveGroup(group.name, group.id)
    const before = storage!.listGroups()
    if (backend === 'sqlite') fixtures.failAtOrder = 1
    else fixtures.failWrite = true
    expect(() => storage!.reorderGroups(['c', 'a', 'b'])).toThrow()
    expect(storage!.listGroups()).toEqual(before)
    fixtures.failWrite = false
    fixtures.failAtOrder = -1
    storage!.close()
    storage = new StorageService()
    expect(storage.listGroups()).toEqual(before)
  })
})

describe('JSON group order migration', () => {
  it('sorts fallback metadata by stored order and does not expose mutable group records', () => {
    fixtures.data = mkdtempSync(join(tmpdir(), 'remotehub-group-reorder-'))
    fixtures.fallback = true
    const groups = initialGroups().reverse()
    writeFileSync(join(fixtures.data, 'remotehub.metadata.json'), JSON.stringify({ groups, connections: [] }))
    storage = new StorageService()
    const listed = storage.listGroups()
    expect(listed.map(group => group.id)).toEqual(['a', 'b', 'c'])
    listed[0].name = 'Modified outside storage'
    expect(storage.listGroups()[0].name).toBe('A')
    storage.reorderGroups(['b', 'c', 'a'])
    const saved = JSON.parse(readFileSync(join(fixtures.data, 'remotehub.metadata.json'), 'utf8'))
    expect(saved.groups.map((group: Group) => group.id)).toEqual(['b', 'c', 'a'])
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function setupStore() {
  setActivePinia(createPinia())
  const groups = initialGroups()
  const savedGroups = (ids: string[]) => ids.map((id, sortOrder) => ({ ...groups.find(group => group.id === id)!, sortOrder }))
  const reorder = vi.fn(async (ids: string[]) => savedGroups(ids))
  const save = vi.fn(async (name: string, id?: string) => ({ id: id || 'd', name, sortOrder: id ? 0 : 3 }))
  const remove = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('window', { api: { groups: { reorder, save, delete: remove } } })
  const store = useConnectionStore()
  store.groups = groups
  store.connections = ['a', 'b', 'c', undefined].map((groupId, index) => ({ id: `server-${index}`, name: 'Server', type: 'ssh', host: 'localhost', port: 22, groupId, favorite: false, sortOrder: index, createdAt: 1, updatedAt: 1 } satisfies Connection))
  store.selectedId = 'server-1'
  return { store, reorder, save, remove, savedGroups }
}

describe('optimistic group movement', () => {
  it('moves before and after targets without changing selection, assets, or memberships', async () => {
    const { store, reorder } = setupStore()
    const connections = store.connections.map(item => ({ ...item }))
    const moved = store.moveGroup('c', 'a')
    expect(store.groups.map(group => group.id)).toEqual(['c', 'a', 'b'])
    await moved
    expect(reorder).toHaveBeenLastCalledWith(['c', 'a', 'b'])
    await store.moveGroup('c', 'b', true)
    expect(store.groups.map(group => group.id)).toEqual(['a', 'b', 'c'])
    expect(store.connections).toEqual(connections)
    expect(store.selectedId).toBe('server-1')
    expect(store.groups.map(group => group.sortOrder)).toEqual([0, 1, 2])
  })

  it('ignores unknown targets, unknown groups, self-drops, and unchanged order', async () => {
    const { store, reorder } = setupStore()
    await store.moveGroup('missing', 'a')
    await store.moveGroup('a', 'missing')
    await store.moveGroup('a', 'a')
    await store.moveGroup('a', 'b')
    expect(reorder).not.toHaveBeenCalled()
    expect(store.groups).toEqual(initialGroups())
  })

  it('rolls back a failed optimistic move and propagates the error', async () => {
    const { store, reorder } = setupStore()
    reorder.mockRejectedValueOnce(new Error('Save failed'))
    const result = store.moveGroup('c', 'a')
    expect(store.groups.map(group => group.id)).toEqual(['c', 'a', 'b'])
    await expect(result).rejects.toThrow('Save failed')
    expect(store.groups).toEqual(initialGroups())
    await store.moveGroup('b', 'a')
    expect(store.groups.map(group => group.id)).toEqual(['b', 'a', 'c'])
  })

  it('serializes rapid moves and does not overwrite newer optimistic state with an older response', async () => {
    const { store, reorder, savedGroups } = setupStore()
    const first = deferred<Group[]>()
    const second = deferred<Group[]>()
    reorder.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const move1 = store.moveGroup('c', 'a')
    const move2 = store.moveGroup('b', 'c')
    await Promise.resolve()
    expect(reorder).toHaveBeenCalledTimes(1)
    expect(store.groups.map(group => group.id)).toEqual(['b', 'c', 'a'])
    first.resolve(savedGroups(['c', 'a', 'b']))
    await move1
    expect(store.groups.map(group => group.id)).toEqual(['b', 'c', 'a'])
    expect(reorder).toHaveBeenLastCalledWith(['b', 'c', 'a'])
    const rejected = expect(move2).rejects.toThrow('Second save failed')
    second.reject(new Error('Second save failed'))
    await rejected
    expect(store.groups.map(group => group.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps a later successful move even when an earlier queued save fails', async () => {
    const { store, reorder } = setupStore()
    reorder.mockRejectedValueOnce(new Error('First save failed'))
    const first = store.moveGroup('c', 'a')
    const second = store.moveGroup('b', 'c')
    await expect(first).rejects.toThrow('First save failed')
    await second
    expect(store.groups.map(group => group.id)).toEqual(['b', 'c', 'a'])
  })

  it('rolls back to the confirmed baseline if every queued save fails', async () => {
    const { store, reorder } = setupStore()
    reorder.mockRejectedValue(new Error('Offline'))
    const first = store.moveGroup('c', 'a')
    const second = store.moveGroup('b', 'c')
    await Promise.all([expect(first).rejects.toThrow('Offline'), expect(second).rejects.toThrow('Offline')])
    expect(store.groups).toEqual(initialGroups())
  })

  it('preserves a queued rename and includes a newly created group in the reorder payload', async () => {
    const { store, reorder } = setupStore()
    const rename = store.saveGroup('Renamed A', 'a')
    const create = store.saveGroup('D')
    const move = store.moveGroup('c', 'a')
    await Promise.all([rename, create, move])
    expect(reorder).toHaveBeenLastCalledWith(['c', 'a', 'b', 'd'])
    expect(store.groups.find(group => group.id === 'a')?.name).toBe('Renamed A')
    expect(store.groups.map(group => group.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('excludes a queued deleted group without resurrecting it during rollback', async () => {
    const { store, reorder } = setupStore()
    reorder.mockRejectedValueOnce(new Error('Save failed'))
    const remove = store.deleteGroup('b')
    const move = store.moveGroup('c', 'a')
    await remove
    await expect(move).rejects.toThrow('Save failed')
    expect(reorder).toHaveBeenLastCalledWith(['c', 'a'])
    expect(store.groups.map(group => group.id)).toEqual(['a', 'c'])
    expect(store.connections.find(connection => connection.id === 'server-1')?.groupId).toBeUndefined()
  })
})
