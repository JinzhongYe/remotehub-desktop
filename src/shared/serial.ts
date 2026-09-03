export const SERIAL_BAUD_RATES = [110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 128000, 230400, 256000, 460800, 921600]
export const SERIAL_ENCODINGS = ['utf8', 'gbk', 'gb18030', 'big5', 'ascii', 'latin1', 'utf16le'] as const

export interface SerialOptions {
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 1.5 | 2
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space'
  encoding: typeof SERIAL_ENCODINGS[number]
  flowControl: 'none' | 'hardware' | 'software'
  lineEnding: 'cr' | 'lf' | 'crlf'
}

export const DEFAULT_SERIAL_OPTIONS: SerialOptions = {
  dataBits: 8, stopBits: 1, parity: 'none', encoding: 'utf8', flowControl: 'none', lineEnding: 'cr'
}

export function normalizeSerialOptions(value?: Partial<SerialOptions>): SerialOptions {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid serial options')
  const result = { ...DEFAULT_SERIAL_OPTIONS, ...value }
  if (![5, 6, 7, 8].includes(result.dataBits) || ![1, 1.5, 2].includes(result.stopBits)
    || !['none', 'even', 'odd', 'mark', 'space'].includes(result.parity)
    || !(SERIAL_ENCODINGS as readonly string[]).includes(result.encoding)
    || !['none', 'hardware', 'software'].includes(result.flowControl)
    || !['cr', 'lf', 'crlf'].includes(result.lineEnding)) throw new Error('Invalid serial options')
  return { dataBits: result.dataBits, stopBits: result.stopBits, parity: result.parity, encoding: result.encoding, flowControl: result.flowControl, lineEnding: result.lineEnding }
}

export function serialPortSettings(options: SerialOptions): { dataBits: SerialOptions['dataBits']; stopBits: SerialOptions['stopBits']; parity: SerialOptions['parity']; rtscts: boolean; xon: boolean; xoff: boolean } {
  return { dataBits: options.dataBits, stopBits: options.stopBits, parity: options.parity, rtscts: options.flowControl === 'hardware', xon: options.flowControl === 'software', xoff: options.flowControl === 'software' }
}

export function serialLineEnding(options: SerialOptions): string {
  return options.lineEnding === 'crlf' ? '\r\n' : options.lineEnding === 'lf' ? '\n' : '\r'
}

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  vendorId?: string
  productId?: string
}

export type SerialSessionStatus = 'connecting' | 'connected' | 'error' | 'closed'

export interface SerialDataEvent {
  sessionId: string
  data: string
}

export interface SerialStatusEvent {
  sessionId: string
  status: SerialSessionStatus
  code?: string
  message?: string
}

export function isValidBaudRate(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 4_000_000
}
