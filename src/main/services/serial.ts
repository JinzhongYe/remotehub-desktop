import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import iconv from 'iconv-lite'
import type { SerialDataEvent, SerialPortInfo, SerialStatusEvent } from '../../shared/serial'
import { isValidBaudRate, normalizeSerialOptions, serialPortSettings, serialLineEnding, type SerialOptions } from '../../shared/serial'
import { initialTerminalInput } from '../../shared/terminal-input'
import type { Connection, ConnectionTestResult } from '../../shared/types'
import { appError, type StorageService } from './storage'

export type SerialPortLike = {
  isOpen: boolean
  on(event: string, listener: (...args: unknown[]) => void): SerialPortLike
  open(callback: (error?: Error) => void): void
  write(data: Buffer, callback: (error?: Error) => void): boolean
  drain(callback: (error?: Error) => void): void
  close(callback?: (error?: Error) => void): void
}
export type SerialPortConstructor = {
  new (options: { path: string; baudRate: number; autoOpen: boolean } & ReturnType<typeof serialPortSettings>): SerialPortLike
  list(): Promise<SerialPortInfo[]>
}
type SerialSession = { id: string; connectionId: string; port: SerialPortLike; options: SerialOptions; decoder: ReturnType<typeof iconv.getDecoder> }
type EventSink = (channel: 'serial:data' | 'serial:status', payload: SerialDataEvent | SerialStatusEvent) => void

const loadNativeModule = createRequire(__filename)

export class SerialService {
  private readonly sessions = new Map<string, SerialSession>()

  constructor(private readonly storage: StorageService, private readonly send: EventSink, private readonly portConstructor?: () => SerialPortConstructor) {}

  async listPorts(): Promise<SerialPortInfo[]> {
    const SerialPort = this.loadConstructor()
    const ports = await SerialPort.list()
    return ports.map((port) => ({
      path: String(port.path),
      manufacturer: port.manufacturer ? String(port.manufacturer) : undefined,
      serialNumber: port.serialNumber ? String(port.serialNumber) : undefined,
      vendorId: port.vendorId ? String(port.vendorId) : undefined,
      productId: port.productId ? String(port.productId) : undefined
    }))
  }

  connect(connection: Connection): Promise<{ sessionId: string }> {
    if (connection.type !== 'serial') throw appError('SERIAL_CONNECTION_INVALID', 'Only serial connections can open a serial terminal')
    validateSerial(connection.host, connection.port)
    const options = normalizeSerialOptions(connection.serialOptions)
    const SerialPort = this.loadConstructor()
    const port = new SerialPort({ path: connection.host, baudRate: connection.port, autoOpen: false, ...serialPortSettings(options) })
    const sessionId = randomUUID()
    const session: SerialSession = { id: sessionId, connectionId: connection.id, port, options, decoder: iconv.getDecoder(options.encoding) }
    this.sessions.set(sessionId, session)
    this.emitStatus({ sessionId, status: 'connecting' })

    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (error: unknown): void => {
        const message = error instanceof Error ? error.message : 'Serial connection failed'
        this.emitStatus({ sessionId, status: 'error', code: 'SERIAL_CONNECTION_FAILED', message })
        if (!settled) {
          settled = true
          this.closeSession(sessionId, false)
          reject(appError('SERIAL_CONNECTION_FAILED', message))
        } else {
          this.closeSession(sessionId, false)
        }
      }
      port.on('data', (chunk: unknown) => {
        if (!this.sessions.has(sessionId)) return
        const data = Buffer.isBuffer(chunk) ? session.decoder.write(chunk) : String(chunk)
        if (data) this.emitData({ sessionId, data })
      })
      port.on('error', fail)
      port.on('close', () => {
        if (!settled) fail(new Error('Serial port closed before initialization completed'))
        else this.closeSession(sessionId, true)
      })
      port.open((error) => {
        if (error) return fail(error)
        if (settled || !this.sessions.has(sessionId)) {
          if (port.isOpen) port.close()
          if (!settled) fail(new Error('Serial connection was canceled'))
          return
        }
        try { this.storage.markConnected(connection.id, Date.now()) } catch { /* metadata is best effort */ }
        this.emitStatus({ sessionId, status: 'connected' })
        const initialInput = connection.initialCommand || ''
        const ready = Promise.resolve().then(() => initialInput ? this.write(sessionId, initialInput) : undefined)
        void ready.then(() => {
          if (settled) return
          settled = true
          resolve({ sessionId })
        }, fail)
      })
    })
  }

  test(connection: Connection): Promise<ConnectionTestResult> {
    validateSerial(connection.host, connection.port)
    const options = normalizeSerialOptions(connection.serialOptions)
    const startedAt = Date.now()
    const SerialPort = this.loadConstructor()
    const port = new SerialPort({ path: connection.host, baudRate: connection.port, autoOpen: false, ...serialPortSettings(options) })
    return new Promise((resolve) => {
      port.open((error) => {
        const testedAt = Date.now()
        if (error) {
          resolve({ ok: false, code: 'CONNECTION_FAILED', message: error.message, latencyMs: testedAt - startedAt, testedAt })
          return
        }
        port.close(() => resolve({ ok: true, code: 'OK', message: 'Serial port opened successfully', latencyMs: testedAt - startedAt, testedAt }))
      })
    })
  }

  write(sessionId: string, data: string): Promise<void> {
    if (typeof data !== 'string' || data.length > 1024 * 1024) throw appError('SERIAL_INPUT_INVALID', 'Serial input is invalid')
    const session = this.getSession(sessionId)
    const bytes = iconv.encode(initialTerminalInput(data, serialLineEnding(session.options)), session.options.encoding)
    return new Promise((resolve, reject) => session.port.write(bytes, (error) => {
      if (error) return reject(appError('SERIAL_WRITE_FAILED', error.message))
      session.port.drain((drainError) => drainError ? reject(appError('SERIAL_WRITE_FAILED', drainError.message)) : resolve())
    }))
  }

  disconnect(sessionId: string): void {
    if (typeof sessionId !== 'string' || sessionId.length > 100) throw appError('SERIAL_SESSION_INVALID', 'Serial session identifier is invalid')
    this.closeSession(sessionId, true)
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.closeSession(id, false)
  }

  private loadConstructor(): SerialPortConstructor {
    if (this.portConstructor) return this.portConstructor()
    try {
      const module = loadNativeModule('serialport') as { SerialPort?: SerialPortConstructor }
      if (!module.SerialPort) throw new Error('SerialPort export is unavailable')
      return module.SerialPort
    } catch {
      throw appError('SERIAL_UNAVAILABLE', 'Serial module is unavailable; run npm install and restart')
    }
  }

  private getSession(sessionId: string): SerialSession {
    if (typeof sessionId !== 'string' || sessionId.length > 100) throw appError('SERIAL_SESSION_INVALID', 'Serial session identifier is invalid')
    const session = this.sessions.get(sessionId)
    if (!session) throw appError('SERIAL_SESSION_NOT_FOUND', 'Serial session is not available')
    return session
  }

  private closeSession(sessionId: string, notify: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    const remaining = session.decoder.end()
    if (remaining) this.emitData({ sessionId, data: remaining })
    if (session.port.isOpen) {
      try { session.port.close() } catch { /* best effort */ }
    }
    if (notify) this.emitStatus({ sessionId, status: 'closed' })
  }

  private emitData(event: SerialDataEvent): void {
    try { this.send('serial:data', event) } catch { /* renderer may already be closed */ }
  }

  private emitStatus(event: SerialStatusEvent): void {
    try { this.send('serial:status', event) } catch { /* renderer may already be closed */ }
  }
}

function validateSerial(path: string, baudRate: number): void {
  if (typeof path !== 'string' || !path.trim() || path.length > 1024) throw appError('SERIAL_PATH_INVALID', 'Serial port path is invalid')
  if (!isValidBaudRate(baudRate)) throw appError('SERIAL_BAUD_INVALID', 'Baud rate must be between 1 and 4,000,000')
}
