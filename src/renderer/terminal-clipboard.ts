/** Return false for shortcuts handled outside xterm, before it emits control bytes. */
export function terminalClipboardKeyHandler(hasSelection: () => boolean, copy: () => void, paste: () => void): (event: KeyboardEvent) => boolean {
  return (event) => {
    if (event.altKey || event.isComposing || (!event.ctrlKey && !event.metaKey)) return true
    const key = event.key.toLowerCase()
    const isCopy = key === 'c' && (hasSelection() || event.shiftKey || event.metaKey)
    if (!isCopy && key !== 'v') return true
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'keydown' && !event.repeat) {
      if (isCopy) copy()
      else paste()
    }
    return false
  }
}
