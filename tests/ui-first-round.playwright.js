// Run against npm run web:dev -- --host 127.0.0.1 --port 5187:
// playwright-cli run-code --filename=tests/ui-first-round.playwright.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('remotehub.locale', 'en')
    localStorage.setItem('remotehub.theme', 'dark')
    const ok = async () => ({ ok: true })
    const listen = () => () => undefined
    const database = { id: 'db', name: 'QA database', type: 'database', databaseType: 'mysql', host: 'test.invalid', port: 3306, username: 'test', favorite: false, sortOrder: 0 }
    const ftp = { id: 'ftp', name: 'QA files', type: 'ftp', host: 'test.invalid', port: 21, authType: 'password', favorite: false, sortOrder: 1 }
    let rows = [[1, 'old']]
    window.qa = { saves: 0, batches: [], failBatch: true, failFileSave: true }
    const files = {
      connect: async () => ({ sessionId: 'files', homePath: '/' }),
      list: async () => [{ path: '/notes.txt', name: 'notes.txt', type: 'file', size: 3, modifiedAt: 1 }],
      listTransfers: async () => [], readText: async () => ({ content: 'old', modifiedAt: 1 }),
      writeText: async () => { if (window.qa.failFileSave) throw new Error('File save rejected') },
      disconnect: ok, onTransfer: listen, onStatus: listen
    }
    window.api = {
      capabilities: { connectionManagement: true, ssh: true, sftp: true, database: true, databaseSqlite: true, databaseSshTunnel: false, ftp: true, serial: false, localShell: false, localFiles: true, sftpTransferControl: false, codexStatus: false },
      app: { getInfo: async () => ({ name: 'RemoteHub', version: 'test', platform: 'linux', dataPath: '' }), setTheme: ok, onCloseRequest: listen, onFullscreenChange: listen, onBackRequest: listen,
        listLocalDirectory: async () => ({ path: '/tmp', parentPath: '/', entries: [] }) },
      connections: { list: async () => ({ connections: [database, ftp], groups: [] }), save: () => new Promise((resolve, reject) => { window.qa.saves++; window.qa.failSave = () => reject(new Error('Credential storage unavailable')) }), test: async () => ({ ok: true, latencyMs: 1 }) },
      groups: {}, ftp: files, sftp: files,
      database: {
        connect: async () => ({ sessionId: 'database', adapter: 'mysql', database: 'app', serverVersion: '8.4' }),
        listDatabases: async () => [{ name: 'app', system: false }], useDatabase: async () => ({ database: 'app' }),
        listTables: async () => [{ database: 'app', name: 'cells', type: 'table' }],
        listColumns: async () => [{ name: 'id', key: 'PRI', dataType: 'int', columnType: 'int', ordinal: 1, nullable: false }, { name: 'name', dataType: 'text', columnType: 'text', ordinal: 2, nullable: true }],
        query: async () => ({ kind: 'rows', columns: [{ name: 'id' }, { name: 'name' }], rows: rows.map((row) => [...row]), page: 0, pageSize: 200, hasMore: false, affectedRows: 0, durationMs: 1 }),
        applyChanges: async (_sessionId, request) => { window.qa.batches.push(request); if (window.qa.failBatch) throw new Error('Batch rolled back'); rows = [[1, 'new']] ; return { ok: true } },
        disconnect: ok, onStatus: listen
      }
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5187/')
  await page.locator('.workspace-connection-card').first().waitFor()

  await page.locator('.new-connection-button').click()
  await page.getByLabel('Name', { exact: true }).fill('New server')
  await page.getByLabel('Host', { exact: true }).fill('test.invalid')
  await page.getByLabel('Username', { exact: true }).fill('test')
  await page.getByRole('button', { name: 'Save connection', exact: true }).click()
  assert(await page.getByRole('button', { name: 'Saving…', exact: true }).isDisabled(), 'Save button must be disabled while submitting')
  await page.evaluate(() => window.qa.failSave())
  await page.locator('#connection-save-error').waitFor()
  assert(await page.locator('#connection-save-error').textContent() === 'Credential storage unavailable', 'Save error must be inside the dialog')
  assert(await page.locator('#connection-save-error').evaluate((element) => document.activeElement === element), 'Save error must receive focus')
  assert(await page.evaluate(() => window.qa.saves) === 1, 'Only one save must be submitted')
  await page.locator('.connection-dialog .dialog-actions').getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.locator('.workspace-connection-card').filter({ hasText: 'QA database' }).click()
  await page.locator('.schema-table > button').click()
  await page.locator('.result-grid input').first().waitFor()
  if (await page.locator('.database-action-menu').isVisible()) await page.locator('.database-action-menu summary').click()
  await page.getByRole('button', { name: 'View table structure', exact: true }).click()
  assert(await page.locator('.table-structure-section').isVisible(), 'Table structure must be visible on a phone')
  assert(await page.locator('.structure-field-table').isVisible(), 'Fields must be visible on a phone')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Structure must not overflow the phone viewport')
  await page.screenshot({ path: '.playwright-cli/first-round-mobile.png' })
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByRole('button', { name: 'Light mode', exact: true }).click()
  assert(await page.locator('.structure-field-table').isVisible(), 'Fields must remain visible on desktop')
  await page.screenshot({ path: '.playwright-cli/first-round-desktop.png' })
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'View table data', exact: true }).click()
  const nameInput = page.locator('.result-grid td input').nth(1)
  await nameInput.fill('new')
  await nameInput.press('Tab')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByText('Batch rolled back', { exact: true }).waitFor()
  assert(await nameInput.inputValue() === 'new', 'Failed batch must retain the draft')
  assert(await page.evaluate(() => window.qa.batches.length) === 1, 'Table changes must be sent as one batch')

  await page.locator('.workspace-tab.active .tab-close').click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert(await nameInput.inputValue() === 'new', 'Cancelling workspace close must retain changes')
  await page.evaluate(() => { window.qa.failBatch = false })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.result-toolbar button[aria-label="Save changes"]')?.disabled === true)
  await page.locator('.workspace-tab.active .tab-close').click()
  await page.locator('.workspace-connection-card').first().waitFor()
  assert(await page.getByRole('alertdialog').count() === 0, 'Saved data must not trigger another discard prompt')

  await page.locator('.workspace-connection-card').filter({ hasText: 'QA files' }).click()
  await page.locator('.sftp-mobile-tabs').getByRole('tab', { name: 'Remote', exact: true }).click()
  await page.getByRole('button', { name: 'notes.txt', exact: true }).click()
  const fileEditor = page.getByRole('textbox', { name: 'Online text editor', exact: true })
  await fileEditor.fill('changed')
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await page.locator('.sftp-editor [role="alert"]').waitFor()
  assert(await fileEditor.inputValue() === 'changed', 'Failed file save must retain the draft')
  await page.locator('.sftp-editor .dialog-actions').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  assert(await fileEditor.isVisible(), 'Cancelling discard must keep the file editor open')
  await page.locator('.sftp-editor .dialog-actions').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard unsaved changes', exact: true }).click()
  await fileEditor.waitFor({ state: 'hidden' })
  assert(errors.length === 0, `Unexpected browser errors: ${errors.join(', ')}`)
  return 'Passed: mobile structure, connection save feedback, database batch/draft protection, file editor discard protection'
}
