<script setup lang="ts">
import { basicSetup, EditorView } from 'codemirror'
import { MySQL, PostgreSQL, SQLite, sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DatabaseCatalog, DatabaseCell, DatabaseColumn, DatabaseQueryResult, DatabaseTable } from '../../shared/database'
import { DATABASE_PAGE_SIZE, databaseDisplayRows } from '../../shared/database'
import { t } from '../i18n'
import { useConnectionStore } from '../stores/connection'

const props = defineProps<{ connectionId: string }>()
const connections = useConnectionStore()
const connection = computed(() => connections.connections.find((item) => item.id === props.connectionId))
const isPostgres = computed(() => connection.value?.databaseType === 'postgres')
const isSqlite = computed(() => connection.value?.databaseType === 'sqlite')

const editorHost = ref<HTMLElement | null>(null)
const sessionId = ref('')
const databases = ref<DatabaseCatalog[]>([])
const selectedDatabase = ref('')
const activeDatabase = ref('')
const tables = ref<DatabaseTable[]>([])
const columnsByTable = ref<Record<string, DatabaseColumn[]>>({})
const expandedTable = ref('')
const expandedSchema = ref('')
const openedTables = ref<DatabaseTable[]>([])
const activeTableName = ref('')
const activeTable = computed(() => openedTables.value.find((table) => tableKey(table) === activeTableName.value) || null)
const workspaceMode = ref<'table' | 'sql'>('sql')
const schemaFilter = ref('')
const rowFilter = ref('')
const sortColumn = ref(-1)
const sortDirection = ref<'asc' | 'desc'>('asc')
const sqlResult = ref<DatabaseQueryResult | null>(null)
const tableResults = ref<Record<string, DatabaseQueryResult>>({})
const connecting = ref(true)
const loadingSchema = ref(false)
const running = ref(false)
const errorMessage = ref('')
const serverVersion = ref('')
const sqlLastSql = ref('')
const tableLastSql = ref<Record<string, string>>({})
const cellContextMenu = ref<{ x: number; y: number; row: DatabaseCell[]; rowIndex: number; columnIndex: number; value: DatabaseCell } | null>(null)
const selectedCell = ref<{ row: DatabaseCell[]; rowNumber: number; columnIndex: number; columnName: string; columnType: string; value: DatabaseCell } | null>(null)
let editor: EditorView | undefined
let disposed = false

function sectionsFor(source: DatabaseTable[]): { type: string; label: string; items: DatabaseTable[] }[] {
  const needle = schemaFilter.value.trim().toLocaleLowerCase()
  const visible = needle ? source.filter((table) => table.name.toLocaleLowerCase().includes(needle)) : source
  return [
    { type: 'table', label: t('tables'), items: visible.filter((table) => table.type === 'table') },
    { type: 'view', label: t('views'), items: visible.filter((table) => table.type === 'view') }
  ].filter((section) => section.items.length)
}

const tableSections = computed(() => sectionsFor(tables.value))
const visibleDatabases = computed(() => isPostgres.value ? databases.value.filter((database) => !database.system) : databases.value)
const postgresSchemas = computed(() => [...new Set(tables.value.map((table) => table.database))].map((name) => ({
  name,
  sections: sectionsFor(tables.value.filter((table) => table.database === name))
})))

const result = computed(() => workspaceMode.value === 'table' && activeTableName.value
  ? tableResults.value[activeTableName.value] || null
  : sqlResult.value)

const lastSql = computed(() => workspaceMode.value === 'table' && activeTableName.value
  ? tableLastSql.value[activeTableName.value] || ''
  : sqlLastSql.value)

const displayRows = computed(() => result.value?.kind === 'rows'
  ? databaseDisplayRows(result.value.rows, rowFilter.value, sortColumn.value, sortDirection.value)
  : [])

const resultSummary = computed(() => {
  if (!result.value) return t('queryReady')
  if (result.value.kind === 'mutation') return t('affectedRows', { count: result.value.affectedRows, duration: result.value.durationMs })
  return rowFilter.value.trim()
    ? t('visibleRows', { visible: displayRows.value.length, total: result.value.rows.length, duration: result.value.durationMs })
    : t('queryRows', { count: result.value.rows.length, duration: result.value.durationMs })
})

watch(result, () => {
  cellContextMenu.value = null
  selectedCell.value = null
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
    selectedDatabase.value = connected.database && visibleDatabases.value.some((item) => item.name === connected.database)
      ? connected.database
      : visibleDatabases.value[0]?.name || ''
    if (selectedDatabase.value) await changeDatabase()
  } catch (error) { showError(error) } finally { connecting.value = false }
}

async function changeDatabase(): Promise<void> {
  if (!sessionId.value || !selectedDatabase.value) return
  const previousDatabase = activeDatabase.value
  loadingSchema.value = true
  errorMessage.value = ''
  try {
    await window.api.database.useDatabase(sessionId.value, selectedDatabase.value)
    const nextTables = await window.api.database.listTables(sessionId.value, selectedDatabase.value)
    activeDatabase.value = selectedDatabase.value
    tables.value = nextTables
    expandedTable.value = ''
    expandedSchema.value = ''
    openedTables.value = []
    activeTableName.value = ''
    sqlResult.value = null
    sqlLastSql.value = ''
    tableResults.value = {}
    tableLastSql.value = {}
    columnsByTable.value = {}
    workspaceMode.value = 'sql'
    if (isPostgres.value) expandedSchema.value = postgresSchemas.value.some((schema) => schema.name === 'public') ? 'public' : postgresSchemas.value[0]?.name || ''
  } catch (error) {
    if (previousDatabase && previousDatabase !== selectedDatabase.value) await window.api.database.useDatabase(sessionId.value, previousDatabase).catch(() => undefined)
    selectedDatabase.value = previousDatabase
    showError(error)
  } finally { loadingSchema.value = false }
}

async function selectDatabase(name: string): Promise<void> {
  if (name === selectedDatabase.value || running.value) return
  selectedDatabase.value = name
  await changeDatabase()
}

async function refreshSchema(): Promise<void> {
  if (!sessionId.value) return
  try {
    databases.value = await window.api.database.listDatabases(sessionId.value)
    if (selectedDatabase.value) {
      tables.value = await window.api.database.listTables(sessionId.value, selectedDatabase.value)
      columnsByTable.value = {}
      if (isPostgres.value && !postgresSchemas.value.some((schema) => schema.name === expandedSchema.value)) expandedSchema.value = postgresSchemas.value[0]?.name || ''
    }
  } catch (error) { showError(error) }
}

async function loadColumns(table: DatabaseTable): Promise<void> {
  const key = tableKey(table)
  if (columnsByTable.value[key] || !sessionId.value) return
  columnsByTable.value = {
    ...columnsByTable.value,
    [key]: await window.api.database.listColumns(sessionId.value, isPostgres.value ? table.database : selectedDatabase.value, table.name)
  }
}

async function toggleTable(table: DatabaseTable): Promise<void> {
  const key = tableKey(table)
  if (expandedTable.value === key) {
    expandedTable.value = ''
    return
  }
  expandedTable.value = key
  try { await loadColumns(table) } catch (error) { showError(error) }
}

async function openTable(table: DatabaseTable): Promise<void> {
  const key = tableKey(table)
  if (!openedTables.value.some((item) => tableKey(item) === key)) openedTables.value.push(table)
  activeTableName.value = key
  expandedTable.value = key
  workspaceMode.value = 'table'
  rowFilter.value = ''
  sortColumn.value = -1
  try { await loadColumns(table) } catch (error) { showError(error) }
  if (!tableResults.value[key]) await runQuery(0, tableQuery(table))
}

function activateTable(table: DatabaseTable): void {
  activeTableName.value = tableKey(table)
  workspaceMode.value = 'table'
  rowFilter.value = ''
  sortColumn.value = -1
}

function closeTable(table: DatabaseTable): void {
  const key = tableKey(table)
  const index = openedTables.value.findIndex((item) => tableKey(item) === key)
  if (index < 0) return
  openedTables.value.splice(index, 1)
  delete tableResults.value[key]
  delete tableLastSql.value[key]
  if (activeTableName.value !== key) return
  activeTableName.value = tableKey(openedTables.value[index] || openedTables.value[index - 1])
  if (!activeTableName.value) workspaceMode.value = 'sql'
}

function openTableSql(): void {
  workspaceMode.value = 'sql'
  if (activeTable.value) setEditorText(tableQuery(activeTable.value))
}

async function runEditorQuery(): Promise<void> {
  workspaceMode.value = 'sql'
  rowFilter.value = ''
  sortColumn.value = -1
  await runQuery(0)
}

async function refreshResult(): Promise<void> {
  const page = result.value?.kind === 'rows' ? result.value.page : 0
  await runQuery(page, workspaceMode.value === 'table' && activeTable.value ? tableQuery(activeTable.value) : lastSql.value)
}

async function runQuery(page = 0, sqlOverride?: string): Promise<void> {
  if (!sessionId.value || running.value) return
  const targetTable = workspaceMode.value === 'table' ? activeTableName.value : ''
  const previousSql = targetTable ? tableLastSql.value[targetTable] : sqlLastSql.value
  const query = sqlOverride ?? (page === 0 ? selectedSql() : previousSql)
  if (!query.trim()) return
  if (targetTable) tableLastSql.value[targetTable] = query
  else sqlLastSql.value = query
  running.value = true
  errorMessage.value = ''
  try {
    const nextResult = await window.api.database.query(sessionId.value, { sql: query, page, pageSize: DATABASE_PAGE_SIZE })
    if (targetTable) {
      if (openedTables.value.some((table) => tableKey(table) === targetTable)) tableResults.value[targetTable] = nextResult
    } else sqlResult.value = nextResult
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

function insertTableName(table: DatabaseTable): void {
  workspaceMode.value = 'sql'
  if (!editor) return
  const value = qualifiedTableName(table)
  const selection = editor.state.selection.main
  editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: value }, selection: { anchor: selection.from + value.length } })
  editor.focus()
}

function handleEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void runEditorQuery()
  }
}

function toggleSort(index: number): void {
  if (sortColumn.value === index) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  else {
    sortColumn.value = index
    sortDirection.value = 'asc'
  }
}

function columnType(index: number): string {
  const name = result.value?.columns[index]?.name
  return (activeTable.value && name ? columnsByTable.value[tableKey(activeTable.value)]?.find((column) => column.name === name)?.columnType : undefined)
    || result.value?.columns[index]?.type || ''
}

function tableQuery(table: DatabaseTable): string {
  return `SELECT * FROM ${qualifiedTableName(table)};`
}

function qualifiedTableName(table: DatabaseTable): string {
  return `${quoteIdentifier(isPostgres.value ? table.database : selectedDatabase.value)}.${quoteIdentifier(table.name)}`
}

function tableKey(table?: DatabaseTable): string {
  return table ? `${table.database}.${table.name}` : ''
}

function quoteIdentifier(value: string): string {
  return isPostgres.value || isSqlite.value ? `"${value.replaceAll('"', '""')}"` : `\`${value.replaceAll('`', '``')}\``
}

function displayCell(value: string | number | boolean | null): string {
  return value == null ? 'NULL' : String(value)
}

function showCellContextMenu(event: MouseEvent, row: DatabaseCell[], rowIndex: number, columnIndex: number, value: DatabaseCell): void {
  event.preventDefault()
  event.stopPropagation()
  cellContextMenu.value = {
    x: Math.max(4, Math.min(event.clientX, window.innerWidth - 154)),
    y: Math.max(4, Math.min(event.clientY, window.innerHeight - 48)),
    row,
    rowIndex,
    columnIndex,
    value
  }
}

function showFullCellData(): void {
  const target = cellContextMenu.value
  if (!target || result.value?.kind !== 'rows') return
  selectedCell.value = {
    row: target.row,
    rowNumber: result.value.page * result.value.pageSize + target.rowIndex + 1,
    columnIndex: target.columnIndex,
    columnName: result.value.columns[target.columnIndex]?.name || `#${target.columnIndex + 1}`,
    columnType: columnType(target.columnIndex),
    value: target.value
  }
  cellContextMenu.value = null
}

function closeCellDetail(): void {
  selectedCell.value = null
}

function closeCellContextMenu(): void {
  cellContextMenu.value = null
}

function showError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : t('databaseUnavailable')
}

async function exportResult(): Promise<void> {
  if (!result.value || result.value.kind !== 'rows') return
  try {
    await window.api.database.exportCsv({
      fileName: `remotehub-results-page-${result.value.page + 1}.csv`,
      columns: result.value.columns.map((column) => column.name),
      rows: displayRows.value
    })
  } catch (error) { showError(error) }
}

onMounted(async () => {
  document.addEventListener('pointerdown', closeCellContextMenu)
  await nextTick()
  if (editorHost.value) editor = new EditorView({
    parent: editorHost.value,
    doc: isSqlite.value ? 'SELECT sqlite_version() AS version;' : 'SELECT VERSION() AS version;',
    extensions: [basicSetup, sql({ dialect: isPostgres.value ? PostgreSQL : isSqlite.value ? SQLite : MySQL }), oneDark, EditorView.lineWrapping]
  })
  await connect()
})

onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('pointerdown', closeCellContextMenu)
  editor?.destroy()
  if (sessionId.value) void window.api.database.disconnect(sessionId.value).catch(() => undefined)
})
</script>

<template>
  <section class="database-pane">
    <header class="database-toolbar">
      <span class="database-kind">{{ isPostgres ? 'PG' : isSqlite ? 'SQ' : 'MY' }}</span>
      <strong>{{ t(isPostgres ? 'postgresWorkspace' : isSqlite ? 'sqliteWorkspace' : 'mysqlWorkspace') }}</strong>
      <select v-if="!isPostgres" v-model="selectedDatabase" :disabled="!sessionId || connecting || running" @change="changeDatabase">
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
        <label class="schema-search"><span>⌕</span><input v-model="schemaFilter" :placeholder="t('searchObjects')"></label>
        <template v-if="isPostgres">
          <div v-if="!visibleDatabases.length && connecting" class="schema-empty">{{ t('loading') }}</div>
          <div v-for="database in visibleDatabases" v-else :key="database.name" class="database-node" :class="{ active: selectedDatabase === database.name }">
            <button :disabled="running" @click="selectDatabase(database.name)"><span>{{ selectedDatabase === database.name ? '⌄' : '›' }}</span><i>DB</i><strong>{{ database.name }}</strong></button>
            <template v-if="selectedDatabase === database.name">
              <div v-if="loadingSchema" class="schema-empty">{{ t('loading') }}</div>
              <div v-else-if="!tables.length" class="schema-empty">{{ t('emptyDatabase') }}</div>
              <div v-for="schema in postgresSchemas" v-else :key="schema.name" class="schema-node" :class="{ active: expandedSchema === schema.name }">
                <button @click="expandedSchema = expandedSchema === schema.name ? '' : schema.name"><span>{{ expandedSchema === schema.name ? '⌄' : '›' }}</span><i>S</i><strong>{{ schema.name }}</strong></button>
                <template v-if="expandedSchema === schema.name">
                  <div v-if="!schema.sections.length" class="schema-empty">{{ t('noMatchingObjects') }}</div>
                  <template v-for="section in schema.sections" v-else :key="section.type">
                    <div class="schema-group"><span>{{ section.type === 'table' ? '▦' : '▤' }}</span><strong>{{ section.label }}</strong><small>{{ section.items.length }}</small></div>
                    <div v-for="table in section.items" :key="tableKey(table)" class="schema-table" :class="{ active: activeTableName === tableKey(table) }">
                      <button :title="t('doubleClickPreview')" @click="toggleTable(table)" @dblclick.stop="openTable(table)"><span>{{ expandedTable === tableKey(table) ? '⌄' : '›' }}</span><i>{{ table.type === 'view' ? 'V' : 'T' }}</i><strong>{{ table.name }}</strong><small v-if="table.estimatedRows != null">{{ table.estimatedRows }}</small></button>
                      <div v-if="expandedTable === tableKey(table)" class="schema-columns"><button class="schema-insert" @click="insertTableName(table)">＋ {{ t('insertName') }}</button><span v-if="!columnsByTable[tableKey(table)]">{{ t('loading') }}</span><span v-for="column in columnsByTable[tableKey(table)] || []" :key="column.name" :title="column.columnType"><b>{{ column.key === 'PRI' ? '◆' : '·' }}</b><em>{{ column.name }}</em><small>{{ column.columnType }}</small></span></div>
                    </div>
                  </template>
                </template>
              </div>
            </template>
          </div>
        </template>
        <template v-else>
          <div v-if="loadingSchema" class="schema-empty">{{ t('loading') }}</div>
          <div v-else-if="!selectedDatabase" class="schema-empty">{{ t('chooseDatabase') }}</div>
          <div v-else-if="!tables.length" class="schema-empty">{{ t('emptyDatabase') }}</div>
          <div v-else-if="!tableSections.length" class="schema-empty">{{ t('noMatchingObjects') }}</div>
          <template v-for="section in tableSections" v-else :key="section.type">
            <div class="schema-group"><span>{{ section.type === 'table' ? '▦' : '▤' }}</span><strong>{{ section.label }}</strong><small>{{ section.items.length }}</small></div>
            <div v-for="table in section.items" :key="tableKey(table)" class="schema-table" :class="{ active: activeTableName === tableKey(table) }">
              <button :title="t('doubleClickPreview')" @click="toggleTable(table)" @dblclick.stop="openTable(table)"><span>{{ expandedTable === tableKey(table) ? '⌄' : '›' }}</span><i>{{ table.type === 'view' ? 'V' : 'T' }}</i><strong>{{ table.name }}</strong><small v-if="table.estimatedRows != null">{{ table.estimatedRows }}</small></button>
              <div v-if="expandedTable === tableKey(table)" class="schema-columns"><button class="schema-insert" @click="insertTableName(table)">＋ {{ t('insertName') }}</button><span v-if="!columnsByTable[tableKey(table)]">{{ t('loading') }}</span><span v-for="column in columnsByTable[tableKey(table)] || []" :key="column.name" :title="column.columnType"><b>{{ column.key === 'PRI' ? '◆' : '·' }}</b><em>{{ column.name }}</em><small>{{ column.columnType }}</small></span></div>
            </div>
          </template>
        </template>
      </aside>
      <main class="sql-workspace">
        <nav class="database-tabs">
          <button :class="{ active: workspaceMode === 'sql' }" @click="workspaceMode = 'sql'">⌁ {{ t('sqlEditor') }}</button>
          <div v-for="table in openedTables" :key="tableKey(table)" class="database-table-tab" :class="{ active: workspaceMode === 'table' && activeTableName === tableKey(table) }"><button @click="activateTable(table)">▦ {{ isPostgres ? `${table.database}.${table.name}` : table.name }}</button><button class="database-tab-close" :aria-label="t('closeTab')" @click="closeTable(table)">×</button></div>
        </nav>
        <section v-show="workspaceMode === 'sql'" class="sql-editor-section">
          <div class="sql-section-toolbar"><span>{{ t('sqlEditor') }}</span><small>{{ t('runShortcut') }}</small><button class="toolbar-button" :disabled="!sessionId || running" @click="runEditorQuery">▶ {{ running ? t('runningQuery') : t('runQuery') }}</button></div>
          <div ref="editorHost" class="sql-editor-host" @keydown="handleEditorKeydown"></div>
        </section>
        <section class="result-section" :class="{ 'table-mode': workspaceMode === 'table' }">
          <div class="result-toolbar">
            <strong>{{ workspaceMode === 'table' && activeTable ? isPostgres ? `${activeTable.database}.${activeTable.name}` : activeTable.name : t('resultGrid') }}</strong>
            <small>{{ resultSummary }}</small>
            <label v-if="result?.kind === 'rows'" class="row-filter"><span>⌕</span><input v-model="rowFilter" :placeholder="t('filterRows')"></label>
            <button class="toolbar-button muted" :disabled="!result || running" @click="refreshResult">↻ {{ t('refresh') }}</button>
            <button v-if="workspaceMode === 'table'" class="toolbar-button muted" @click="openTableSql">⌁ {{ t('openInSql') }}</button>
            <button v-if="result?.kind === 'rows'" class="toolbar-button" @click="exportResult">⇩ {{ t('exportPage') }}</button>
          </div>
          <div class="result-grid-wrap">
            <div v-if="!result" class="result-empty">{{ t('queryReady') }}</div>
            <div v-else-if="result.kind === 'mutation'" class="mutation-result"><strong>{{ t('queryCompleted') }}</strong><span>{{ t('affectedRows', { count: result.affectedRows, duration: result.durationMs }) }}</span><span v-if="result.insertId">Insert ID: {{ result.insertId }}</span></div>
            <table v-else class="result-grid">
              <thead><tr><th class="row-number">#</th><th v-for="(column, index) in result.columns" :key="`${column.name}:${index}`" :title="column.table"><button @click="toggleSort(index)"><span>{{ column.name }} <i v-if="sortColumn === index">{{ sortDirection === 'asc' ? '↑' : '↓' }}</i></span><small v-if="columnType(index)">{{ columnType(index) }}</small></button></th></tr></thead>
              <tbody><tr v-for="(row, rowIndex) in displayRows" :key="rowIndex"><td class="row-number">{{ result.page * result.pageSize + rowIndex + 1 }}</td><td v-for="(cell, cellIndex) in row" :key="cellIndex" :class="{ null: cell == null, selected: selectedCell?.row === row && selectedCell.columnIndex === cellIndex }" :title="displayCell(cell)" @contextmenu="showCellContextMenu($event, row, rowIndex, cellIndex, cell)">{{ displayCell(cell) }}</td></tr></tbody>
            </table>
          </div>
          <section v-if="selectedCell" class="cell-detail-panel">
            <header><strong>{{ t('cellDetail') }}</strong><span>{{ selectedCell.columnName }}<template v-if="selectedCell.columnType"> · {{ selectedCell.columnType }}</template></span><small>#{{ selectedCell.rowNumber }}</small><button :aria-label="t('closeView')" @click="closeCellDetail">×</button></header>
            <textarea readonly spellcheck="false" :value="displayCell(selectedCell.value)"></textarea>
          </section>
          <footer v-if="result?.kind === 'rows'" class="result-status">
            <code :title="lastSql">{{ lastSql }}</code><span>{{ resultSummary }}</span>
            <div class="result-pager"><button :disabled="running || result.page === 0" @click="runQuery(result.page - 1)">‹</button><span>{{ t('pageNumber', { page: result.page + 1 }) }}</span><button :disabled="running || !result.hasMore" @click="runQuery(result.page + 1)">›</button></div>
          </footer>
        </section>
      </main>
    </div>
    <div v-if="cellContextMenu" class="database-cell-context-menu" role="menu" :style="{ left: `${cellContextMenu.x}px`, top: `${cellContextMenu.y}px` }" @pointerdown.stop>
      <button role="menuitem" @click="showFullCellData">{{ t('showFullData') }}</button>
    </div>
  </section>
</template>
