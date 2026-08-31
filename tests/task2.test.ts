import { describe, expect, it } from 'vitest'
import { clampSplitRatio, normalizeSftpPosition } from '../src/renderer/stores/workspace'

describe('Task 2 workspace settings', () => {
  it('accepts supported SFTP docks and falls back below the terminal', () => {
    expect(['left', 'right', 'top', 'bottom'].map(normalizeSftpPosition)).toEqual(['left', 'right', 'top', 'bottom'])
    expect(normalizeSftpPosition('sideways')).toBe('bottom')
  })

  it('keeps draggable split panes usable', () => {
    expect([5, 50, 95].map(clampSplitRatio)).toEqual([20, 50, 80])
  })
})
