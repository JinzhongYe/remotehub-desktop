export function tabWheelDelta(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'>, width: number): number {
  if (event.ctrlKey) return 0 // Keep browser/OS zoom gestures intact.
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  const pixels = delta * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? width : 1)
  return Number.isFinite(pixels) ? pixels : 0
}

export function tabDragScroll(clientX: number, left: number, right: number): number {
  if (clientX < left || clientX > right) return 0
  if (clientX < left + 28) return -12
  if (clientX > right - 28) return 12
  return 0
}
