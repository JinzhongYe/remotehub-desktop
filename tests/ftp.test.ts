import { describe, expect, it } from 'vitest'
import { ftpPath } from '../src/main/services/ftp'

describe('FTP path validation', () => {
  it('normalizes paths and blocks FTP command injection', () => {
    expect(ftpPath('/files/../upload/report.txt')).toBe('/upload/report.txt')
    expect(() => ftpPath('/upload/report.txt\r\nDELE /important')).toThrow('line breaks')
  })
})
