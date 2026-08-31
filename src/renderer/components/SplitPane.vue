<script setup lang="ts">
import { ref } from 'vue'
import { clampSplitRatio } from '../stores/workspace'

type SplitDirection = 'horizontal' | 'vertical'

const props = withDefaults(defineProps<{ direction: SplitDirection; reverse?: boolean; initial?: number }>(), { initial: 50 })
const root = ref<HTMLElement | null>(null)
const ratio = ref(clampSplitRatio(props.initial))
const dragging = ref(false)

function startResize(event: PointerEvent): void {
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function resize(event: PointerEvent): void {
  if (!dragging.value || !root.value) return
  const bounds = root.value.getBoundingClientRect()
  const physical = props.direction === 'horizontal' ? (event.clientX - bounds.left) / bounds.width : (event.clientY - bounds.top) / bounds.height
  ratio.value = clampSplitRatio((props.reverse ? 1 - physical : physical) * 100)
}

function stopResize(event: PointerEvent): void {
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

function resizeWithKeyboard(event: KeyboardEvent): void {
  const delta = props.direction === 'horizontal'
    ? event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0
    : event.key === 'ArrowUp' ? -2 : event.key === 'ArrowDown' ? 2 : 0
  if (!delta) return
  ratio.value = clampSplitRatio(ratio.value + (props.reverse ? -delta : delta))
  event.preventDefault()
}
</script>

<template>
  <div ref="root" class="resizable-split" :class="[direction, { reverse, dragging }]" :style="{ '--split-ratio': `${ratio}%` }">
    <div class="split-section split-first"><slot name="first" /></div>
    <div class="split-divider" role="separator" tabindex="0" :aria-orientation="direction === 'horizontal' ? 'vertical' : 'horizontal'" :aria-valuemin="20" :aria-valuemax="80" :aria-valuenow="Math.round(ratio)" @pointerdown.prevent="startResize" @pointermove="resize" @pointerup="stopResize" @pointercancel="stopResize" @keydown="resizeWithKeyboard"></div>
    <div class="split-section split-second"><slot name="second" /></div>
  </div>
</template>
