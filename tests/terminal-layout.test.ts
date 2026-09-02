import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from 'xterm'
import type { FitAddon } from 'xterm-addon-fit'
import { loadTerminalFont, observeTerminalLayout } from '../src/renderer/terminal-layout'

function fixture() {
  let render = (): void => {}
  let resize = (): void => {}
  let id = 0
  const frames = new Map<number, FrameRequestCallback>()
  const windowEvents = new EventTarget()
  const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve(), load: vi.fn(async () => []) })
  const observer = { observe: vi.fn(), disconnect: vi.fn() }
  vi.stubGlobal('window', Object.assign(windowEvents, {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id },
    cancelAnimationFrame: (key: number) => frames.delete(key)
  }))
  vi.stubGlobal('document', { fonts })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = observer.observe
    disconnect = observer.disconnect
  })
  const screen = { style: { width: '800px' } }
  const row = { style: { height: '21px' } }
  const host = {
    clientWidth: 1200, clientHeight: 700, style: { setProperty: vi.fn() },
    querySelector: (selector: string) => selector === '.xterm-screen' ? screen : row
  }
  const renderDispose = vi.fn()
  const terminal = { cols: 80, rows: 24, resize: vi.fn(), onRender: (callback: () => void) => { render = callback; return { dispose: renderDispose } } }
  const addon = { fit: vi.fn() }
  const onFit = vi.fn()
  const layout = observeTerminalLayout(host as unknown as HTMLElement, terminal as unknown as Terminal, addon as unknown as FitAddon, onFit)
  const flush = (): void => { const next = [...frames.values()]; frames.clear(); next.forEach(callback => callback(0)) }
  return { host, screen, row, terminal, addon, onFit, observer, renderDispose, layout, frames, fonts, flush, resize: () => resize(), render: () => render(), windowEvents }
}

afterEach(() => vi.unstubAllGlobals())

describe('terminal viewport layout', () => {
  it('fits restored sessions on the next frame without needing a tab switch', () => {
    const view = fixture()
    view.layout.fit()
    view.resize()
    expect(view.frames.size).toBe(1)
    view.flush()
    expect(view.terminal.resize).toHaveBeenCalledWith(80, 24)
    expect(view.addon.fit).toHaveBeenCalledOnce()
    expect(view.host.style.setProperty).toHaveBeenCalledWith('--terminal-row-height', '21px')
    expect(view.onFit).toHaveBeenCalledOnce()
    view.layout.dispose()
  })

  it('waits while a restored pane is hidden, then fits as soon as it becomes visible', () => {
    const view = fixture()
    view.host.clientWidth = 0
    view.host.clientHeight = 0
    view.flush()
    expect(view.addon.fit).not.toHaveBeenCalled()
    view.host.clientWidth = 1600
    view.host.clientHeight = 900
    view.resize()
    view.flush()
    expect(view.addon.fit).toHaveBeenCalledOnce()
    view.layout.dispose()
  })

  it('refits every visible split pane when its size changes', () => {
    const view = fixture()
    for (const [width, height] of [[1600, 900], [800, 900], [800, 450], [510, 450], [1600, 900]]) {
      view.host.clientWidth = width
      view.host.clientHeight = height
      view.resize()
      view.flush()
    }
    expect(view.addon.fit).toHaveBeenCalledTimes(5)
    view.layout.dispose()
  })

  it('updates stripes and refits after new character metrics without a render loop', () => {
    const view = fixture()
    view.flush()
    view.row.style.height = '24px'
    view.screen.style.width = '960px'
    view.render()
    expect(view.host.style.setProperty).toHaveBeenLastCalledWith('--terminal-row-height', '24px')
    view.flush()
    view.render()
    expect(view.frames.size).toBe(0)
    expect(view.addon.fit).toHaveBeenCalledTimes(2)
    view.layout.dispose()
  })

  it('responds to font readiness, font loading, and window scaling changes', async () => {
    const view = fixture()
    view.flush()
    await view.fonts.ready
    view.flush()
    view.fonts.dispatchEvent(new Event('loadingdone'))
    view.windowEvents.dispatchEvent(new Event('resize'))
    view.flush()
    expect(view.addon.fit).toHaveBeenCalledTimes(3)
    view.layout.dispose()
  })

  it('ignores unmeasured rows and releases queued work/listeners when closed', async () => {
    const view = fixture()
    view.row.style.height = '0px'
    view.flush()
    expect(view.host.style.setProperty).not.toHaveBeenCalled()
    view.layout.fit()
    view.layout.dispose()
    await view.fonts.ready
    view.fonts.dispatchEvent(new Event('loadingdone'))
    view.windowEvents.dispatchEvent(new Event('resize'))
    view.resize()
    expect(view.frames.size).toBe(0)
    expect(view.observer.disconnect).toHaveBeenCalledOnce()
    expect(view.renderDispose).toHaveBeenCalledOnce()
  })

  it('loads the bundled terminal font before measuring, with a safe fallback on failure', async () => {
    const view = fixture()
    await loadTerminalFont(14)
    expect(view.fonts.load).toHaveBeenCalledWith('14px "JetBrains Mono"')
    view.fonts.load.mockRejectedValueOnce(new Error('Font unavailable'))
    await expect(loadTerminalFont(13)).resolves.toBeUndefined()
    view.layout.dispose()
  })
})
