import { describe, expect, it } from 'vitest'
import { withoutAnsiBackgrounds } from '../src/shared/ansi'

describe('light terminal ANSI filtering', () => {
  it('removes indexed, RGB and split background colors while preserving foreground colors', () => {
    expect(withoutAnsiBackgrounds('\x1b[38;5;2mgreen\x1b[48;5;235mdark\x1b[48;2;38;38;38mrgb').output)
      .toBe('\x1b[38;5;2mgreendarkrgb')

    const first = withoutAnsiBackgrounds('\x1b[48;5;')
    expect(first).toEqual({ output: '', remainder: '\x1b[48;5;' })
    expect(withoutAnsiBackgrounds(first.remainder + '235mtext')).toEqual({ output: 'text', remainder: '' })
  })
})
