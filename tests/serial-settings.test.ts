import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import iconv from 'iconv-lite'
import { SerialService, type SerialPortConstructor } from '../src/main/services/serial'
import type { StorageService } from '../src/main/services/storage'
import type { Connection } from '../src/shared/types'
import { DEFAULT_SERIAL_OPTIONS, normalizeSerialOptions, serialPortSettings } from '../src/shared/serial'

vi.mock('electron', () => ({ app: {} }))

function fixture() {
  const ports: FakePort[] = []
  class FakePort extends EventEmitter {
    isOpen = false
    writes: Buffer[] = []
    constructor(readonly options: ConstructorParameters<SerialPortConstructor>[0]) { super(); ports.push(this) }
    static async list() { return [{ path: 'COM7' }] }
    open(callback: (error?: Error) => void) { this.isOpen = true; callback() }
    write(data: Buffer, callback: (error?: Error) => void) { this.writes.push(data); callback(); return true }
    drain(callback: (error?: Error) => void) { callback() }
    close(callback?: (error?: Error) => void) { this.isOpen = false; this.emit('close'); callback?.() }
  }
  const sink = vi.fn(), storage = { markConnected: vi.fn() } as unknown as StorageService
  const service = new SerialService(storage, sink, () => FakePort)
  const connection: Connection = { id: 'serial-1', name: 'MES Serial', type: 'serial', host: 'COM7', port: 115200, createdAt: 1, updatedAt: 1, favorite: false, sortOrder: 0 }
  return { ports, service, sink, connection, FakePort }
}

describe('serial settings', () => {
  it('keeps legacy connections on 8N1 / UTF-8 without flow control', () => {
    expect(normalizeSerialOptions()).toEqual(DEFAULT_SERIAL_OPTIONS)
    expect(serialPortSettings(DEFAULT_SERIAL_OPTIONS)).toEqual({ dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, xon: false, xoff: false })
  })
  it('rejects invalid settings instead of silently using a different configuration', () => {
    for (const invalid of [{ dataBits: 9 }, { stopBits: 3 }, { parity: 'bad' }, { encoding: 'wrong' }, { flowControl: 'wrong' }, { lineEnding: 'bad' }, null, []]) {
      expect(() => normalizeSerialOptions(invalid as never)).toThrow('Invalid serial options')
    }
  })
  it('passes framing and hardware/software flow control to the serial driver', async () => {
    const { service, connection, ports } = fixture()
    await service.connect({ ...connection, serialOptions: { ...DEFAULT_SERIAL_OPTIONS, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' } })
    expect(ports[0].options).toMatchObject({ dataBits: 7, stopBits: 2, parity: 'even', rtscts: true, xon: false, xoff: false })
    await service.connect({ ...connection, serialOptions: { ...DEFAULT_SERIAL_OPTIONS, flowControl: 'software' } })
    expect(ports[1].options).toMatchObject({ rtscts: false, xon: true, xoff: true })
    service.dispose()
  })
  it('sends initialization exactly once per new session without appending Enter', async () => {
    const { service, connection, ports } = fixture()
    const config = { ...connection, initialCommand: 'first\nsecond' }
    const first = await service.connect(config)
    expect(Buffer.concat(ports[0].writes).toString()).toBe('first\rsecond')
    await service.write(first.sessionId, 'x')
    expect(ports[0].writes.map(b => b.toString())).toEqual(['first\rsecond', 'x'])
    service.disconnect(first.sessionId)
    await service.connect(config)
    expect(Buffer.concat(ports[1].writes).toString()).toBe('first\rsecond')
    service.dispose()
  })
  it('tests the chosen framing without sending initialization commands', async () => {
    const { service, connection, ports } = fixture()
    const result = await service.test({ ...connection, initialCommand: 'DO NOT RUN\n', serialOptions: { ...DEFAULT_SERIAL_OPTIONS, dataBits: 7, parity: 'odd' } })
    expect(result.ok).toBe(true)
    expect(ports[0].options).toMatchObject({ dataBits: 7, parity: 'odd' })
    expect(ports[0].writes).toHaveLength(0)
    expect(ports[0].isOpen).toBe(false)
  })
  it('closes a port that finishes opening after the session was canceled', async () => {
    const { service, connection, ports, FakePort } = fixture()
    let finishOpen: () => void = () => {}
    vi.spyOn(FakePort.prototype, 'open').mockImplementation(function(callback) { finishOpen = () => { this.isOpen = true; callback() } })
    const result = service.connect({ ...connection, initialCommand: 'must not send\n' })
    service.dispose()
    finishOpen()
    await expect(result).rejects.toThrow()
    expect(ports[0].isOpen).toBe(false)
    expect(ports[0].writes).toHaveLength(0)
  })
  it('reports initialization write failures and releases the device', async () => {
    const { service, connection, ports, FakePort, sink } = fixture()
    vi.spyOn(FakePort.prototype, 'write').mockImplementation((_data, callback) => { callback(new Error('device write failed')); return false })
    const { sessionId } = await service.connect({ ...connection, initialCommand: 'startup' })
    await vi.waitFor(() => expect(ports[0].isOpen).toBe(false))
    expect(sink).toHaveBeenCalledWith('serial:status', expect.objectContaining({ sessionId, status: 'error', message: 'device write failed' }))
  })
  it('returns a usable session even while hardware flow control blocks initialization drain', async () => {
    const { service, connection, ports, FakePort } = fixture()
    vi.spyOn(FakePort.prototype, 'drain').mockImplementation(() => {})
    const { sessionId } = await service.connect({ ...connection, initialCommand: 'startup\n', serialOptions: { ...DEFAULT_SERIAL_OPTIONS, flowControl: 'hardware' } })
    expect(ports[0].writes[0].toString()).toBe('startup\r')
    expect(ports[0].isOpen).toBe(true)
    service.disconnect(sessionId)
    expect(ports[0].isOpen).toBe(false)
  })
  it.each(['utf8', 'gbk', 'gb18030', 'big5'] as const)('decodes %s across packet boundaries and encodes outgoing text', async encoding => {
    const { service, connection, ports, sink } = fixture()
    const { sessionId } = await service.connect({ ...connection, serialOptions: { ...DEFAULT_SERIAL_OPTIONS, encoding, lineEnding: 'crlf' } })
    const bytes = iconv.encode('中文測試', encoding)
    for (const byte of bytes) ports[0].emit('data', Buffer.from([byte]))
    const output = sink.mock.calls.filter(([channel]) => channel === 'serial:data').map(([, payload]) => payload.data).join('')
    expect(output).toBe('中文測試')
    await service.write(sessionId, '中文\n')
    expect(ports[0].writes[0]).toEqual(iconv.encode('中文\r\n', encoding))
    service.dispose()
  })
})
