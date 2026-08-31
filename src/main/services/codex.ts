import { parseCodexStatus, type CodexStatus } from '../../shared/codex'

export interface CodexAppServerTransport {
  onData(listener: (data: unknown) => void): void
  onError(listener: (error: unknown) => void): void
  onClose(listener: () => void): void
  write(data: string): void
  close(): void
}

export function queryCodexUsage(open: (ready: (transport: CodexAppServerTransport) => void, fail: (error: unknown) => void) => void): Promise<CodexStatus> {
  return new Promise((resolve, reject) => {
    let transport: CodexAppServerTransport | undefined
    let buffer = ''
    let rateResult: unknown
    let usageResult: unknown
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      transport?.close()
      if (error) reject(error instanceof Error ? error : new Error(String(error)))
      else resolve(parseCodexStatus(rateResult, usageResult))
    }
    const send = (message: unknown): void => transport?.write(`${JSON.stringify(message)}\n`)
    const receive = (chunk: unknown): void => {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      if (buffer.length > 1024 * 1024) return finish(new Error('Codex usage response is too large'))
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message: { id?: number; result?: unknown; error?: { message?: string } }
        try { message = JSON.parse(line) as typeof message } catch { continue }
        if (message.error) return finish(new Error(message.error.message || 'Codex App Server request failed'))
        if (message.id === 1) {
          send({ method: 'initialized', params: {} })
          send({ method: 'account/rateLimits/read', id: 2 })
          send({ method: 'account/usage/read', id: 3 })
        } else if (message.id === 2) rateResult = message.result
        else if (message.id === 3) usageResult = message.result
        if (rateResult !== undefined && usageResult !== undefined) finish()
      }
    }
    const timeout = setTimeout(() => finish(new Error('Codex usage request timed out')), 8000)
    try {
      open((stream) => {
        if (settled) return stream.close()
        transport = stream
        stream.onData(receive)
        stream.onError(finish)
        stream.onClose(() => finish(new Error('Codex App Server closed before returning usage')))
        send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'remotehub_desktop', title: 'RemoteHub Desktop', version: '0.1.0' } } })
      }, finish)
    } catch (error) {
      finish(error)
    }
  })
}
