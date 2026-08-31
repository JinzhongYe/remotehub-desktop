<script setup lang="ts">
import { computed } from 'vue'
import type { Connection } from '../../shared/types'
import mysqlIcon from '../assets/mysql.svg'
import postgresIcon from '../assets/postgresql.svg'
import sqliteIcon from '../assets/sqlite.svg'

const props = defineProps<{ connection: Connection }>()
const databaseIcon = computed(() => props.connection.databaseType === 'postgres' ? postgresIcon : props.connection.databaseType === 'sqlite' ? sqliteIcon : mysqlIcon)
</script>

<template>
  <span class="connection-icon" :class="connection.type">
    <img v-if="connection.type === 'database'" :src="databaseIcon" :alt="`${connection.databaseType || 'database'} icon`">
    <span v-else>{{ connection.type === 'serial' ? 'COM' : connection.type === 'shell' ? '>_' : '›_' }}</span>
  </span>
</template>
