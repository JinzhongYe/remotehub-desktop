<script setup lang="ts">
import { basicSetup, EditorView } from 'codemirror'
import { MySQL, PostgreSQL, sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DatabaseCatalog, DatabaseColumn, DatabaseQueryResult, DatabaseTable } from '../../shared/database'
import { DATABASE_PAGE_SIZE } from '../../shared/database'
import { t } from '../i18n'
import { useConnectionStore } from '../stores/connection'

const props = defineProps<{ connectionId: string }>()
const connections = useConnectionStore()
const isPostgres = computed(() => connections.connections.find((item) => item.id === props.connectionId)?.databaseType === 'postgres')

const editorHost = ref<HTMLElement | null>(null)
const sessionId = ref('')
const databases = ref<DatabaseCatalog[]>([])
const selectedDatabase = ref('')
const tables = ref<DatabaseTable[]>([])
const columnsByTable = ref<Record<string, DatabaseColumn[]>>({})
const expandedTable = ref('')
const result = ref<DatabaseQueryResult | null>(null)
const connecting = ref(true)
const loadingSchema = ref(false)
const running = ref(false)
const errorMessage = ref('')
const serverVersion = ref('')
const lastSql = ref('')
let editor: EditorView | undefined
let disposed = false

const resultSummary = computed(() => {
  if (!result.value) return t('queryReady')
  if (result.value.kind === 'mutation') return t('affectedRows', { count: result.value.affectedRows, duration: result.value.durationMs })
  return t('queryRows', { count: result.value.rows.length, duration: result.value.durationMs })
})

async function connect(): Promise<void> {
  connecting.value = true
  errorMessage.value = ''
  if (sessionId.value) await window.api.database.disconnect(sessionId.value).catch(() => undefined)
  sessionId.value = ''
  try {
    const connected = await window.api.database.connect(props.connectionId)
    if (disposed) {
      await window.api.database.disconnect(connected.sessionId).catch(() => undefined)
      return
    }
    sessionId.value = connected.sessionId
    serverVersion.value = connected.serverVersion
    databases.value = await window.api.database.listDatabases(connected.sessionId)
    selectedDatabase.value = connected.database && databases.value.some((item) => item.name === connected.database)
      ? connected.database
      : databases.value.find((item) => !item.system)?.name || databases.value[0]?.name || ''
    if (selectedDatabase.value) await changeDatabase()
  } catch (error) { showError(error) } finally { connecting.value = false }
}

async function changeDatabase(): Promise<void> {
  if (!sessionId.value || !selectedDatabase.value) return
  loadingSchema.value = true
  errorMessage.value = ''
  expandedTable.value = ''
  columnsByTable.value = {}
  try {
    await window.api.database.useDatabase(sessionId.value, selectedDatabase.value)
    tables.value = await window.api.database.listTables(sessionId.value, selectedDatabase.value)
  } catch (error) { showError(error) } finally { loadingSchema.value = false }
}

async function refreshSchema(): Promise<void> {
  if (!sessionId.value) return
  try {
    databases.value = await window.api.database.listDatabases(sessionId.value)
    if (selectedDatabase.value) await changeDatabase()
  } catch (error) { showError(error) }
}

async function toggleTable(table: DatabaseTable): Promise<void> {
  if (expandedTable.value === table.name) {
    expandedTable.value = ''
    return
  }
  expandedTable.value = table.name
  if (columnsByTable.value[table.name] || !sessionId.value) return
  try {
    columnsByTable.value = {
      ...columnsByTable.value,
      [table.name]: await window.api.database.listColumns(sessionId.value, selectedDatabase.value, table.name)
    }
  } catch (error) { showError(error) }
}

function previewTable(table: DatabaseTable): void {
  const query = `SELECT * FROM ${quoteIdentifier(selectedDatabase.value)}.${quoteIdentifier(table.name)};`
  setEditorText(query)
  void runQuery(0)
}

function insertTableName(table: DatabaseTable): void {
  insertEditorText(`${quoteIdentifier(selectedDatabase.value)}.${quoteIdentifier(table.name)}`)
}

async function runQuery(page = 0): Promise<void> {
  if (!sessionId.value || running.value) return
  const query = page === 0 ? selectedSql() : lastSql.value
  if (!query.trim()) return
  if (page === 0) lastSql.value = query
  running.value = true
  errorMessage.value = ''
  try {
    const nextResult = await window.api.database.query(sessionId.value, { sql: query, page, pageSize: DATABASE_PAGE_SIZE })
    result.value = nextResult
    if (nextResult.kind === 'mutation') await refreshSchema()
  } catch (error) { showError(error) } finally { running.value = false }
}

function selectedSql(): string {
  if (!editor) return ''
  const selection = editor.state.selection.main
  return selection.empty ? editor.state.doc.toString() : editor.state.sliceDoc(selection.from, selection.to)
}

function setEditorText(value: string): void {
  if (!editor) return
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor: value.length } })
  editor.focus()
}

function insertEditorText(value: string): void {
  if (!editor) return
  const selection = editor.state.selection.main
  editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: value }, selection: { anchor: selection.from + value.length } })
  editor.focus()
}

function handleEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void runQuery(0)
  }
}

function showError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : t('databaseUnavailable')
}

function quoteIdentifier(value: string): string {
  return isPostgres.value ? `"${value.replaceAll('"', '""')}"` : `\`${value.replaceAll('`', '``')}\``
}

function displayCell(value: string | number | boolean | null): string {
  return value == null ? 'NULL' : String(value)
}

onMounted(async () => {
  await nextTick()
  if (editorHost.value) editor = new EditorView({
    parent: editorHost.value,
    doc: 'SELECT VERSION() AS version;',
    extensions: [basicSetup, sql({ dialect: isPostgres.value ? PostgreSQL : MySQL }), oneDark, EditorView.lineWrapping]
  })
  await connect()
})

onBeforeUnmount(() => {
  disposed = true
  editor?.destroy()
  if (sessionId.value) void window.api.database.disconnect(sessionId.value).catch(() => undefined)
})
</script>

<template>
  <section class="database-pane">
    <header class="database-toolbar">
      <span class="database-kind">{{ isPostgres ? 'PG' : 'MY' }}</span>
      <strong>{{ t(isPostgres ? 'postgresWorkspace' : 'mysqlWorkspace') }}</strong>
      <select v-model="selectedDatabase" :disabled="!sessionId || connecting" @change="changeDatabase">
        <option v-if="!databases.length" value="">{{ t('noDatabase') }}</option>
        <option v-for="database in databases" :key="database.name" :value="database.name">{{ database.name }}{{ database.system ? ` · ${t('systemDatabase')}` : '' }}</option>
      </select>
      <button class="toolbar-button muted" :disabled="!sessionId || loadingSchema" @click="refreshSchema">↻ {{ t('refresh') }}</button>
      <span class="database-server">{{ serverVersion }}</span>
      <span class="terminal-status" :class="{ connecting, error: errorMessage && !sessionId }"><span class="status-dot"></span>{{ connecting ? t('connecting') : sessionId ? t('connected') : t('closed') }}</span>
      <button v-if="!sessionId && !connecting" class="toolbar-button" @click="connect">{{ t('reconnect') }}</button>
    </header>
    <div v-if="errorMessage" class="database-error"><span>{{ errorMessage }}</span><button class="icon-button" @click="errorMessage = ''">×</button></div>
    <div class="database-workspace">
      <aside class="schema-explorer">
        <div class="schema-heading"><span>{{ t('schemaExplorer') }}</span><small>{{ tables.length }}</small></div>
        <div v-if="loadingSchema" class="schema-empty">{{ t('loading') }}</div>
        <div v-else-if="!selectedDatabase" class="schema-empty">{{ t('chooseDatabase') }}</div>
        <div v-else-if="!tables.length" class="schema-empty">{{ t('emptyDatabase') }}</div>
        <div v-for="table in tables" v-else :key="table.name" class="schema-table">
          <button :title="t('doubleClickPreview')" @click="toggleTable(table)" @dblclick="previewTable(table)">
            <span>{{ expandedTable === table.name ? '⌄' : '›' }}</span><i>{{ table.type === 'view' ? 'V' : 'T' }}</i><strong>{{ table.name }}</strong><small v-if="table.estimatedRows != null">{{ table.estimatedRows }}</small>
          </button>
          <div v-if="expandedTable === table.name" class="schema-columns">
            <button class="schema-insert" @click="insertTableName(table)">＋ {{ t('insertName') }}</button>
            <span v-if="!columnsByTable[table.name]">{{ t('loading') }}</span>
            <span v-for="column in columnsByTable[table.name] || []" :key="column.name" :title="column.columnType"><b>{{ column.key === 'PRI' ? '◆' : '·' }}</b><em>{{ column.name }}</em><small>{{ column.columnType }}</small></span>
          </div>
        </div>
      </aside>
      <main class="sql-workspace">
        <section class="sql-editor-section">
          <div class="sql-section-toolbar"><span>{{ t('sqlEditor') }}</span><small>{{ t('runShortcut') }}</small><button class="toolbar-button" :disabled="!sessionId || running" @click="runQuery(0)">▶ {{ running ? t('runningQuery') : t('runQuery') }}</button></div>
          <div ref="editorHost" class="sql-editor-host" @keydown="handleEditorKeydown"></div>
        </section>
        <section class="result-section">
          <div class="result-toolbar">
            <span>{{ t('resultGrid') }}</span><small>{{ resultSummary }}</small>
            <div v-if="result?.kind === 'rows'" class="result-pager"><button :disabled="running || result.page === 0" @click="runQuery(result.page - 1)">‹ {{ t('previousPage') }}</button><span>{{ t('pageNumber', { page: result.page + 1 }) }}</span><button :disabled="running || !result.hasMore" @click="runQuery(result.page + 1)">{{ t('nextPage') }} ›</button></div>
          </div>
          <div class="result-grid-wrap">
            <div v-if="!result" class="result-empty">{{ t('queryReady') }}</div>
            <div v-else-if="result.kind === 'mutation'" class="mutation-result"><strong>{{ t('queryCompleted') }}</strong><span>{{ t('affectedRows', { count: result.affectedRows, duration: result.durationMs }) }}</span><span v-if="result.insertId">Insert ID: {{ result.insertId }}</span></div>
            <table v-else class="result-grid">
              <thead><tr><th class="row-number">#</th><th v-for="(column, index) in result.columns" :key="`${column.name}:${index}`" :title="column.table">{{ column.name }}</th></tr></thead>
              <tbody><tr v-for="(row, rowIndex) in result.rows" :key="rowIndex"><td class="row-number">{{ result.page * result.pageSize + rowIndex + 1 }}</td><td v-for="(cell, cellIndex) in row" :key="cellIndex" :class="{ null: cell == null }" :title="displayCell(cell)">{{ displayCell(cell) }}</td></tr></tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  </section>
</template>
