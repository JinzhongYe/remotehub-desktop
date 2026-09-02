import type { Terminal } from 'xterm'
import type { FitAddon } from 'xterm-addon-fit'

export async function loadTerminalFont(fontSize: number): Promise<void> {
  // Measure the terminal after its bundled monospace font is available, not a fallback font.
  await document.fonts.load(`${fontSize}px "JetBrains Mono"`).catch(() => undefined)
}

export function observeTerminalLayout(host: HTMLElement, terminal: Terminal, addon: FitAddon, onFit?: () => void): { fit(): void; dispose(): void } {
  let disposed = false
  let frame: number | undefined
  let cellWidth = 0
  let cellHeight = 0

  function syncCellSize(): boolean {
    const screen = host.querySelector<HTMLElement>('.xterm-screen')
    const row = host.querySelector<HTMLElement>('.xterm-rows > div')
    const width = screen ? parseFloat(screen.style.width) / terminal.cols : 0
    const height = row ? parseFloat(row.style.height) : 0
    if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) return false
    if (width === cellWidth && height === cellHeight) return false
    cellWidth = width
    cellHeight = height
    host.style.setProperty('--terminal-row-height', `${height}px`)
    return true
  }

  function fit(): void {
    if (disposed || frame !== undefined) return
    frame = window.requestAnimationFrame(() => {
      frame = undefined
      if (disposed || !host.clientWidth || !host.clientHeight) return
      try {
        // An initially hidden terminal may not have measured its characters yet.
        terminal.resize(terminal.cols, terminal.rows)
        addon.fit()
        syncCellSize()
        onFit?.()
      } catch { /* The pane may have been hidden between layout and rendering. */ }
    })
  }

  const observer = new ResizeObserver(fit)
  observer.observe(host)
  // Font metrics and display scaling can change without resizing the host element.
  const render = terminal.onRender(() => { if (syncCellSize()) fit() })
  window.addEventListener('resize', fit)
  document.fonts.addEventListener('loadingdone', fit)
  void document.fonts.ready.then(fit)
  fit()

  return {
    fit,
    dispose() {
      disposed = true
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      observer.disconnect()
      render.dispose()
      window.removeEventListener('resize', fit)
      document.fonts.removeEventListener('loadingdone', fit)
    }
  }
}
