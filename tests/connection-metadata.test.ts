import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { StorageService } from '../src/main/services/storage'
import { createConnectionExport, parseConnectionExport } from '../src/shared/connection'
import { DEFAULT_SERIAL_OPTIONS } from '../src/shared/serial'
import { MAX_INITIAL_COMMAND_LENGTH, MAX_NOTES_LENGTH } from '../src/shared/terminal-input'
import { useConnectionStore } from '../src/renderer/stores/connection'
import type { ConnectionInput } from '../src/shared/types'

const paths = vi.hoisted(() => ({ data: '' }))
vi.mock('electron', () => ({ app: { getPath: () => paths.data } }))
let storage: StorageService
beforeEach(() => { paths.data = mkdtempSync(join(tmpdir(), 'remotehub-metadata-test-')); storage = new StorageService() })
afterEach(() => { storage.close(); if (dirname(resolve(paths.data)) === resolve(tmpdir())) rmSync(paths.data, { recursive: true, force: true }) })

describe('connection notes and terminal configuration', () => {
  it.each(['ssh', 'ftp', 'database', 'serial', 'shell'] as const)('round-trips multiline notes for %s including duplication and restart', type => {
    const connection = storage.saveConnection({ name: 'Asset', type, host: type === 'shell' ? paths.data : 'host', port: 22, notes: '生产 MES\n负责人：测试', color: '#1677ff' })
    expect(storage.getConnection(connection.id)).toMatchObject({ notes: '生产 MES\n负责人：测试', color: '#1677ff' })
    expect(storage.duplicateConnection(connection.id)).toMatchObject({ notes: connection.notes, color: connection.color })
    storage.close(); storage = new StorageService()
    expect(storage.getConnection(connection.id)?.notes).toBe(connection.notes)
    storage.saveConnection({ ...connection, notes: '', color: undefined })
    expect(storage.getConnection(connection.id)?.notes).toBeUndefined()
    expect(storage.getConnection(connection.id)?.color).toBeUndefined()
  })
  it('preserves the exact final newline through save, reload, export and import', () => {
    for (const initialCommand of ['conda activate env\npython', 'conda activate env\npython\n']) {
      const source = storage.saveConnection({ name: 'Shell', type: 'shell', host: paths.data, port: 1, initialCommand })
      expect(storage.getConnection(source.id)?.initialCommand).toBe(initialCommand)
      const exported = createConnectionExport([source], [])
      const restored = parseConnectionExport(JSON.stringify(exported)).connections[0]
      expect(restored.initialCommand).toBe(initialCommand)
      expect(storage.saveConnection(restored).initialCommand).toBe(initialCommand)
    }
  })
  it('retains serial settings during export and clears type-specific fields on type change', () => {
    const source = storage.saveConnection({ name: 'Serial', type: 'serial', host: 'COM7', port: 9600, initialCommand: 'ready', serialOptions: { ...DEFAULT_SERIAL_OPTIONS, encoding: 'gbk', parity: 'even', dataBits: 7, flowControl: 'software' } })
    const restored = parseConnectionExport(JSON.stringify(createConnectionExport([source], []))).connections[0]
    expect(storage.saveConnection(restored).serialOptions).toEqual(source.serialOptions)
    const ssh = storage.saveConnection({ ...source, type: 'ssh', port: 22 })
    expect(ssh.serialOptions).toBeUndefined()
    expect(ssh.initialCommand).toBeUndefined()
  })
  it('accepts legacy imports without newly added properties', () => {
    const parsed = parseConnectionExport(JSON.stringify({ version: 1, groups: [], connections: [{ id: 'legacy', name: 'Legacy', type: 'serial', host: 'COM1', port: 115200 }] }))
    expect(storage.saveConnection(parsed.connections[0]).serialOptions).toEqual(DEFAULT_SERIAL_OPTIONS)
  })
  it('validates metadata and serial settings without silent truncation', () => {
    const source: ConnectionInput = { name: 'Serial', type: 'serial', host: 'COM1', port: 9600 }
    for (const invalid of [{ notes: 42 }, { notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }, { initialCommand: 'x'.repeat(MAX_INITIAL_COMMAND_LENGTH + 1) }, { initialCommand: '\0' }, { color: 'invalid' }, { serialOptions: { dataBits: 10 } }]) expect(() => storage.saveConnection({ ...source, ...invalid } as ConnectionInput)).toThrow()
  })
  it('searches by notes without requiring a matching asset name', () => {
    setActivePinia(createPinia())
    const store = useConnectionStore()
    store.connections = [storage.saveConnection({ name: 'server-1', type: 'ssh', host: 'example', port: 22, notes: '产线 MES 测试' })]
    store.search = 'mes'
    expect(store.filteredConnections).toHaveLength(1)
    store.search = 'unmatched'
    expect(store.filteredConnections).toHaveLength(0)
  })
})
