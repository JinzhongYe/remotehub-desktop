import { describe, expect, it, vi } from 'vitest'
import { initialTerminalInput } from '../src/shared/terminal-input'
import { terminalClipboardKeyHandler } from '../src/renderer/terminal-clipboard'

describe('initial terminal input', () => {
  it('does not append Enter to the final command', () => {
    expect(initialTerminalInput('conda activate python353\npython')).toBe('conda activate python353\rpython')
    expect(initialTerminalInput('python')).toBe('python')
  })
  it('only executes the final line when the user supplied a newline', () => {
    expect(initialTerminalInput('conda activate python353\r\npython\r\n')).toBe('conda activate python353\rpython\r')
    expect(initialTerminalInput('  echo "中文"\n\n')).toBe('  echo "中文"\r\r')
    expect(initialTerminalInput('\n')).toBe('\r')
    expect(initialTerminalInput()).toBe('')
  })
  it('translates existing line endings without duplicating CRLF', () => {
    expect(initialTerminalInput('a\nb\r\nc\rd', '\r\n')).toBe('a\r\nb\r\nc\r\nd')
    expect(initialTerminalInput('a\nb', '\n')).toBe('a\nb')
  })
})

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: 'c', type: 'keydown', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides } as KeyboardEvent
}

describe('terminal clipboard shortcuts', () => {
  it('copies selected text and suppresses the interrupt control byte', () => {
    const copy = vi.fn(), paste = vi.fn(), event = key()
    expect(terminalClipboardKeyHandler(() => true, copy, paste)(event)).toBe(false)
    expect(copy).toHaveBeenCalledOnce()
    expect(paste).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
  it('lets Ctrl+C reach xterm when no text is selected', () => {
    const copy = vi.fn(), event = key()
    expect(terminalClipboardKeyHandler(() => false, copy, vi.fn())(event)).toBe(true)
    expect(copy).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
  it('handles Ctrl+V once, including when text is selected', () => {
    const paste = vi.fn(), handler = terminalClipboardKeyHandler(() => true, vi.fn(), paste)
    expect(handler(key({ key: 'v' }))).toBe(false)
    expect(handler(key({ key: 'v', type: 'keyup' }))).toBe(false)
    expect(handler(key({ key: 'v', repeat: true }))).toBe(false)
    expect(paste).toHaveBeenCalledOnce()
  })
  it('supports terminal-style Ctrl+Shift+C/V and macOS Command+C/V', () => {
    const copy = vi.fn(), paste = vi.fn(), handler = terminalClipboardKeyHandler(() => true, copy, paste)
    for (const shortcut of [key({ shiftKey: true, key: 'C' }), key({ ctrlKey: false, metaKey: true })]) expect(handler(shortcut)).toBe(false)
    for (const shortcut of [key({ shiftKey: true, key: 'V' }), key({ key: 'v', ctrlKey: false, metaKey: true })]) expect(handler(shortcut)).toBe(false)
    expect(copy).toHaveBeenCalledTimes(2)
    expect(paste).toHaveBeenCalledTimes(2)
  })
  it('preserves typing, other control keys, AltGr, and IME composition', () => {
    const action = vi.fn(), handler = terminalClipboardKeyHandler(() => true, action, action)
    for (const event of [key({ ctrlKey: false }), key({ key: 'd' }), key({ altKey: true }), key({ isComposing: true })]) expect(handler(event)).toBe(true)
    expect(action).not.toHaveBeenCalled()
  })
})
