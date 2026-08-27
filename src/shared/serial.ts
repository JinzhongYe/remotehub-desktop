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
