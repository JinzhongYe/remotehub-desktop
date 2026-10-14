// Run with web:dev on 127.0.0.1:5187 and an isolated playwright-cli open --mobile session.
// playwright-cli run-code --filename=tests/ui-third-round.playwright.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message) }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('remotehub.locale', 'en')
    localStorage.setItem('remotehub.theme', 'dark')
    const ok = async () => ({ ok: true })
    const listen = () => () => undefined
    const connection = { id: 'db', name: 'QA schema', type: 'database', databaseType: 'sqlite', host: '/qa.sqlite', port: 0, favorite: false, sortOrder: 0 }
    window.schemaQa = { calls: [], failChecks: true, delay: false, generation: 1 }
    window.api = {
      capabilities: { connectionManagement: true, ssh: false, sftp: false, ftp: false, database: true, databaseSqlite: true, databaseSshTunnel: false, serial: false, localShell: false, localFiles: false, sftpTransferControl: false, codexStatus: false },
      app: { getInfo: async () => ({ name: 'RemoteHub', version: 'test', platform: 'linux', dataPath: '' }), setTheme: ok, onCloseRequest: listen, onBackRequest: listen, onFullscreenChange: listen },
      connections: { list: async () => ({ connections: [connection], groups: [] }) }, groups: {},
      database: {
        connect: async () => ({ sessionId: 'db', adapter: 'sqlite', database: 'main', serverVersion: 'SQLite' }), disconnect: ok, onStatus: listen,
        listDatabases: async () => [{ name: 'main', system: false }, { name: 'attached', system: false }], useDatabase: async (_session, name) => ({ database: name }),
        listTables: async (_session, name) => [{ database: name, name: 'cells', type: 'table' }, { database: name, name: 'empty', type: 'table' }],
        listColumns: async () => [{ name: 'id', key: 'PRI', dataType: 'INTEGER', columnType: 'INTEGER', ordinal: 1, nullable: false }, { name: 'text', dataType: 'TEXT', columnType: 'TEXT', ordinal: 2, nullable: true }],
        query: async () => ({ kind: 'rows', columns: [{ name: 'id' }, { name: 'text' }], rows: [[1, 'unchanged']], page: 0, pageSize: 200, hasMore: false, affectedRows: 0, durationMs: 1 }),
        listTableDetails: async (_session, database, table, section) => {
          window.schemaQa.calls.push({ database, table, section })
          if (window.schemaQa.delay) await new Promise((resolve) => { window.schemaQa.finish = resolve })
          if (section === 'checks' && window.schemaQa.failChecks) throw new Error('Schema access denied')
          if (table === 'empty' || section === 'foreignKeys') return { columns: ['name', 'definition'], rows: [], hasMore: false }
          if (section === 'checks') return { columns: ['name', 'definition'], rows: [['cells', 'CREATE TABLE cells (id INTEGER CHECK (id > 0))']], hasMore: false, notice: 'sqliteCheckDefinitions' }
          return { columns: ['name', 'definition'], rows: [[`${database}_${section}_${window.schemaQa.generation}`, `CREATE ${section.toUpperCase()} ${database}.cells\n${'long definition '.repeat(100)}`]], hasMore: section === 'triggers' }
        }
      }
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5187/')
  await page.locator('.workspace-connection-card').filter({ hasText: 'QA schema' }).click()
  await page.locator('.schema-table').filter({ hasText: 'cells' }).getByRole('button').click()
  await page.locator('.result-grid input').first().waitFor()
  if (await page.locator('.database-action-menu').isVisible()) await page.locator('.database-action-menu summary').click()
  await page.getByRole('button', { name: 'View table structure', exact: true }).click()
  const section = (name) => page.locator('.structure-tabs').getByRole('button', { name, exact: true })
  const refresh = () => page.locator('.structure-toolbar').getByRole('button', { name: 'Refresh', exact: true })
  await page.locator('.structure-field-table').waitFor()
  await section('Indexes').click()
  await page.getByRole('button', { name: 'Name: Show full data', exact: true }).waitFor()
  assert(await page.locator('.schema-metadata-table').textContent().then((text) => text.includes('main_indexes_1')), 'Metadata must load from the provider')
  await page.getByRole('button', { name: 'Definition / SQL: Show full data', exact: true }).focus()
  await page.keyboard.press('Enter')
  const detail = page.locator('.schema-cell-detail textarea')
  assert((await detail.inputValue()).includes('long definition '.repeat(100)), 'Keyboard must reveal the complete definition')
  assert(await detail.evaluate((element) => element === document.activeElement), 'Full SQL must receive keyboard focus')
  await page.locator('.schema-cell-detail').getByRole('button', { name: 'Close this view', exact: true }).click()
  assert(await page.getByRole('button', { name: 'Definition / SQL: Show full data', exact: true }).evaluate((element) => element === document.activeElement), 'Closing full SQL must return focus to its cell')
  await page.keyboard.press('Enter')
  await detail.press('Escape')
  assert(await detail.count() === 0, 'Escape must close the full SQL region')
  await section('Foreign keys').click()
  await page.getByText('No schema information of this kind (only objects visible to your account are shown)', { exact: true }).waitFor()
  await section('Indexes').click()
  await page.locator('.schema-metadata-table').waitFor()
  assert(await page.evaluate(() => window.schemaQa.calls.filter((call) => call.section === 'indexes').length) === 1, 'Switching back must reuse metadata until refresh')
  await page.evaluate(() => { window.schemaQa.generation = 2 })
  await refresh().click()
  await page.waitForFunction(() => document.querySelector('.schema-metadata-table')?.textContent.includes('main_indexes_2'))

  await section('Checks').click()
  await page.locator('.structure-feedback[role="alert"]').waitFor()
  assert((await page.locator('.structure-feedback').textContent()).includes('Schema access denied'), 'Failure must not be shown as an empty catalog')
  await page.evaluate(() => { window.schemaQa.failChecks = false })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByText('SQLite does not expose a separate check-constraint catalog. The original CREATE TABLE SQL below contains the CHECK definitions.', { exact: true }).waitFor()
  assert((await page.locator('.schema-metadata-table').textContent()).includes('CHECK (id > 0)'), 'Retry must show original CHECK SQL')

  await page.evaluate(() => { window.schemaQa.delay = true })
  await section('Triggers').click()
  await page.locator('.table-structure-section [role="status"]').waitFor()
  assert(await refresh().isDisabled(), 'Refresh must be disabled during a metadata request')
  assert(await page.locator('.schema-table').first().getByRole('button').isDisabled(), 'Data queries must not race metadata requests')
  await section('Advanced').click()
  await page.evaluate(() => { window.schemaQa.delay = false; window.schemaQa.finish() })
  await page.waitForFunction(() => document.querySelector('.schema-metadata-table')?.textContent.includes('main_advanced_2'))
  assert(!(await page.locator('.schema-metadata-table').textContent()).includes('main_triggers_2'), 'Slow earlier sections must not overwrite the selected section')
  await section('Triggers').click()
  await page.getByText('Showing the first 5000 items. Use the SQL editor to inspect the remaining items.', { exact: true }).waitFor()

  await page.setViewportSize({ width: 375, height: 812 })
  await section('Advanced').click()
  await page.getByRole('button', { name: 'Definition / SQL: Show full data', exact: true }).click()
  assert(await detail.isVisible(), 'Full SQL must be reachable with a phone tap')
  const tabBox = await section('Advanced').boundingBox()
  assert(tabBox.height >= 44, 'Phone structure tabs must have a 44px touch target')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Metadata must scroll locally, not widen the page')
  await page.screenshot({ path: '.playwright-cli/third-round-phone-dark.png' })
  await page.setViewportSize({ width: 812, height: 375 })
  await page.getByRole('button', { name: 'Light mode', exact: true }).click()
  assert(await detail.isVisible(), 'SQL definition must remain reachable in landscape')
  const detailBox = await detail.boundingBox()
  assert(detailBox.height >= 44 && detailBox.y + detailBox.height <= 375, 'Landscape SQL content must have readable height inside the viewport, not just be mounted')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Landscape must not widen the page')
  await page.screenshot({ path: '.playwright-cli/third-round-landscape-light.png' })
  await page.setViewportSize({ width: 568, height: 320 })
  await detail.scrollIntoViewIfNeeded()
  const smallDetailBox = await detail.boundingBox()
  assert(smallDetailBox.height >= 44 && smallDetailBox.y + smallDetailBox.height <= 320, 'A shorter landscape must allow scrolling to the full SQL content')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Small landscape must not widen the page')

  await page.setViewportSize({ width: 1366, height: 900 })
  await page.locator('.database-selector select').selectOption('attached')
  await page.locator('.schema-table').filter({ hasText: 'cells' }).getByRole('button').click()
  await page.locator('.result-grid input').first().waitFor()
  if (await page.locator('.database-action-menu').isVisible()) await page.locator('.database-action-menu summary').click()
  await page.getByRole('button', { name: 'View table structure', exact: true }).click()
  await section('Indexes').click()
  await page.waitForFunction(() => document.querySelector('.schema-metadata-table')?.textContent.includes('attached_indexes_2'))
  assert(!(await page.locator('.schema-metadata-table').textContent()).includes('main_indexes'), 'A switched database must not reuse same-name table metadata')
  await page.screenshot({ path: '.playwright-cli/third-round-desktop-light.png' })
  assert(errors.length === 0, `Unexpected page errors: ${errors.join(', ')}`)
  return 'Passed: all structure sections, loading, error retry, cache refresh, request ordering, full SQL keyboard/touch, phone/landscape/desktop and database isolation'
}
