<script setup lang="ts">
import { computed } from 'vue'
import type { SftpEntryType } from '../../shared/sftp'
import { fileVisual } from '../file-icon'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ type: SftpEntryType; name?: string }>(), { name: '' })
const visual = computed(() => fileVisual(props.type, props.name))
</script>

<template>
  <span class="file-icon" :class="visual.tone" aria-hidden="true">
    <svg v-if="visual.icon === 'folder'" class="windows-folder-icon" viewBox="0 0 24 20" focusable="false">
      <path class="folder-back" d="M2 4.5A2.5 2.5 0 0 1 4.5 2h5l2.2 2.4h7.8A2.5 2.5 0 0 1 22 6.9v9.6A2.5 2.5 0 0 1 19.5 19h-15A2.5 2.5 0 0 1 2 16.5Z" />
      <path class="folder-front" d="M2 8h20l-1.7 9.3A2.1 2.1 0 0 1 18.2 19H4.1A2.1 2.1 0 0 1 2 16.9Z" />
      <path class="folder-highlight" d="M3.2 9.1h17.4" />
    </svg>
    <span v-else-if="visual.badge" class="file-type-badge">{{ visual.badge }}</span>
    <UiIcon v-else :name="visual.icon" />
  </span>
</template>
