<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })

const icons: Record<string, string> = {
  terminal: 'M5 7l4 4-4 4m7 0h7M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  command: 'M5 8l4 4-4 4m7 0h7',
  transfer: 'M5 7h14m-4-4 4 4-4 4M19 17H5m4 4-4-4 4-4',
  database: 'M4 6c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3Zm0 0v6c0 2 3.6 3 8 3s8-1 8-3V6m-16 6v6c0 2 3.6 3 8 3s8-1 8-3v-6',
  grid: 'M4 4h16v16H4V4Zm8 0v16M4 12h16',
  layoutOne: 'M4 5h16v14H4V5Z',
  layoutTwo: 'M4 5h16v14H4V5Zm8 0v14',
  layoutFour: 'M4 5h16v14H4V5Zm8 0v14M4 12h16',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  pin: 'm9 3 6 6m-8 3 5 5m-3-8 6-6 6 6-6 6m-3 3-7 7',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  upload: 'M12 16V4m-5 5 5-5 5 5M5 20h14',
  download: 'M12 4v12m-5-5 5 5 5-5M5 20h14',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  arrowLeft: 'M19 12H5m6-6-6 6 6 6',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  arrowUp: 'M12 19V5m-6 6 6-6 6 6',
  arrowDown: 'M12 5v14m6-6-6 6-6-6',
  search: 'm20 20-4.5-4.5m2.5-5A7.5 7.5 0 1 1 3 10.5a7.5 7.5 0 0 1 15 0Z',
  folder: 'M3 7h7l2 2h9v10H3V7Z',
  folderUpload: 'M3 8h7l2 2h9v10H3V8Zm9 9v-5m-3 3 3-3 3 3',
  folderPlus: 'M3 7h7l2 2h9v10H3V7Zm9 5v5m-2.5-2.5h5',
  edit: 'm4 20 4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Zm10.8-13.3 3 3',
  panel: 'M4 4h16v16H4V4Zm11 0v16M8 8h3m-3 4h3m-3 4h3',
  gauge: 'M4 15a8 8 0 1 1 16 0M12 15l4-4M6 19h12',
  refresh: 'M20 7v5h-5M4 17v-5h5m9.5-3A7 7 0 0 0 6 7.5L4 12m16 0-2 4.5A7 7 0 0 1 5.5 15',
  power: 'M12 3v9m5.7-6.7a9 9 0 1 1-11.4 0',
  drive: 'M4 5h16l2 6v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7l2-6Zm-2 7h20M6 16h.01M10 16h.01',
  cloud: 'M7 18h11a4 4 0 0 0 .5-8 7 7 0 0 0-13.3 2A3 3 0 0 0 7 18Z',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v5h5',
  fileText: 'M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6m-6 4h6',
  link: 'M10 13a5 5 0 0 0 7.1.1l2-2A5 5 0 0 0 12 4l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14',
  config: 'M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6m-4-2v4m-2 3h6m-2-2v4',
  pdf: 'M6 3h8l4 4v14H6V3Zm8 0v5h5M9 16v-4h2a1.5 1.5 0 0 1 0 3H9m5 1v-4h2',
  image: 'M6 3h8l4 4v14H6V3Zm8 0v5h5m-6 9 2.5-3 2 2 1.5-2 2 3M9 11h.01',
  table: 'M5 4h14v16H5V4Zm0 5h14M10 9v11m5-11v11',
  presentation: 'M4 5h16v11H4V5Zm8 11v4m-4 0h8m-8-8 3-3 2 2 3-3',
  audio: 'M9 18V7l9-2v11M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm9-2a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM9 10l9-2',
  video: 'M4 5h16v14H4V5Zm4 0v14m8-14v14M4 9h4m8 0h4M4 15h4m8 0h4',
  archive: 'M5 4h14v16H5V4Zm5 0v3h4V4m-4 6h4m-4 3h4m-4 3h4',
  key: 'M14 8a4 4 0 1 1-1.2 2.8L4 20v-4l6.2-6.2M7 17h3v-3',
  font: 'M5 20 10 4h4l5 16M7 15h10',
  executable: 'M4 5h16v14H4V5Zm4 5 3 2-3 2m6 0h3',
  book: 'M4 5a3 3 0 0 1 3-2h5v17H7a3 3 0 0 0-3 2V5Zm16 0a3 3 0 0 0-3-2h-5v17h5a3 3 0 0 1 3 2V5Z',
  mail: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  calendar: 'M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4M8 14h.01m4 0h.01m4 0h.01m-8 4h.01m4 0h.01',
  cube: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9',
  trash: 'M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6',
  swapVertical: 'M8 4v16m-4-4 4 4 4-4m4 4V4m-4 4 4-4 4 4',
  pause: 'M9 5v14m6-14v14',
  play: 'm8 5 11 7-11 7V5Z'
}

const path = computed(() => icons[props.name] || icons.file)
</script>

<template>
  <svg class="ui-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="path" />
  </svg>
</template>
