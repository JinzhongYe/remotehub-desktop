<script setup lang="ts">
import { computed } from 'vue'
import type { Connection } from '../../shared/types'
import mysqlIcon from '../assets/mysql.svg'
import postgresIcon from '../assets/postgresql.svg'
import sqliteIcon from '../assets/sqlite.svg'
import UiIcon from './UiIcon.vue'

const props = defineProps<{ connection: Connection }>()
const databaseIcon = computed(() => props.connection.databaseType === 'postgres' ? postgresIcon : props.connection.databaseType === 'sqlite' ? sqliteIcon : mysqlIcon)
const connectionGlyph = computed(() => props.connection.type === 'shell' ? 'command' : props.connection.type === 'ftp' ? 'transfer' : props.connection.type === 'serial' ? 'terminal' : 'terminal')
</script>

<template>
  <span class="connection-icon" :class="connection.type" :title="connection.notes" :style="connection.color ? { borderColor: connection.color, boxShadow: `inset 3px 0 0 ${connection.color}` } : undefined" aria-hidden="true">
    <img v-if="connection.type === 'database'" :src="databaseIcon" alt="">
    <UiIcon v-else :name="connectionGlyph" :size="15" />
  </span>
</template>
