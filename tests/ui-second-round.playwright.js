// Start web:dev on 127.0.0.1:5187, then:
// playwright-cli open --mobile, then run-code --filename=tests/ui-second-round.playwright.js
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
    window.qaClipboard = { copied: '', writes: [] }
    const connections = [
      { id: 'db', name: 'QA database', type: 'database', databaseType: 'mysql', host: 'test.invalid', port: 3306, username: 'test', favorite: false, sortOrder: 0 },
      { id: 'ftp', name: 'QA files', type: 'ftp', host: 'test.invalid', port: 21, favorite: false, sortOrder: 1 },
      { id: 'ssh', name: 'QA password', type: 'ssh', host: 'test.invalid', port: 22, username: 'test', authType: 'none', favorite: false, sortOrder: 2 }
    ]
    const files = { connect: async () => ({ sessionId: 'files', homePath: '/' }), disconnect: ok, onTransfer: listen, onStatus: listen, listTransfers: async () => [],
      list: async () => [{ path: '/notes.txt', name: 'notes.txt', type: 'file', size: 3, modifiedAt: 1 }], readText: async () => ({ content: 'old', modifiedAt: 1 }), writeText: ok }
    window.api = {
      capabilities: { connectionManagement: true, ssh: true, sftp: false, ftp: true, database: true, databaseSqlite: false, databaseSshTunnel: false, serial: false, localShell: false, localFiles: false, sftpTransferControl: false, codexStatus: false },
      app: { getInfo: async () => ({ name: 'RemoteHub', version: 'test', platform: 'linux', dataPath: '' }), setTheme: ok, onCloseRequest: listen, onBackRequest: listen, onFullscreenChange: listen,
        copyText: async (text) => { window.qaClipboard.copied = text }, readText: async () => 'echo qa' },
      connections: { list: async () => ({ connections, groups: [] }) }, groups: {}, ftp: files,
      ssh: { onData: (listener, sessionId) => { window.qaClipboard.sendData = (event) => listener({ ...event, sessionId }); return () => undefined }, onStatus: listen, disconnect: ok, resize: ok, acknowledgeOutput: ok,
        connect: async (_connectionId, _options, sessionId) => ({ sessionId }), write: async (_session, text) => { window.qaClipboard.writes.push(text); return { ok: true } } },
      database: { connect: async () => ({ sessionId: 'db', adapter: 'mysql', database: 'app', serverVersion: '8.4' }), disconnect: ok, onStatus: listen,
        listDatabases: async () => [{ name: 'app', system: false }], useDatabase: async () => ({ database: 'app' }), listTables: async () => [{ database: 'app', name: 'cells', type: 'table' }],
        listColumns: async () => [{ name: 'id', key: 'PRI', dataType: 'int', columnType: 'int', ordinal: 1 }, { name: 'name', dataType: 'text', columnType: 'text', ordinal: 2 }],
        query: async () => ({ kind: 'rows', columns: [{ name: 'id' }, { name: 'name' }], rows: [[1, 'complete cell data']], page: 0, pageSize: 200, hasMore: false, affectedRows: 0, durationMs: 1 }) }
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5187/')
  await page.locator('.workspace-connection-card').first().waitFor()
  const activeTab = () => page.locator('.workspace-tab.active').getAttribute('data-tab-id')
  const focusedInside = (selector) => page.locator(selector).evaluate((element) => element.contains(document.activeElement))
  const expectTrap = async (selector) => {
    const modal = page.locator(selector)
    assert(await modal.evaluate((element) => element.matches(':modal')), 'Dialog must be a native modal')
    await modal.locator('button:not(:disabled)').last().focus()
    await page.keyboard.press('Tab')
    // Chromium may briefly move to browser chrome; no background app control may receive focus.
    assert(await focusedInside(selector) || await page.evaluate(() => document.activeElement === document.body), 'Tab must not reach background controls')
    if (!await focusedInside(selector)) await page.keyboard.press('Tab')
    assert(await focusedInside(selector), 'Tab must return to the modal from browser chrome')
    await page.locator('.new-connection-button').evaluate((element) => element.focus())
    assert(await focusedInside(selector), 'Background controls must be inert')
  }

  await page.locator('.workspace-connection-card').filter({ hasText: 'QA database' }).click()
  await page.locator('.schema-table > button').click()
  await page.locator('.result-grid input').first().waitFor()
  const databaseTab = await activeTab()
  const opener = page.locator('.new-connection-button')
  await opener.click()
  await page.getByLabel('Name', { exact: true }).waitFor()
  assert(await page.getByLabel('Name', { exact: true }).evaluate((element) => element === document.activeElement), 'Name should receive initial focus')
  await expectTrap('dialog:has(.connection-form-fields)')
  for (const shortcut of ['Control+1', 'Control+w', 'Control+n', 'Control+k']) await page.keyboard.press(shortcut)
  assert(await activeTab() === databaseTab, 'Modal must block background workspace shortcuts')
  assert(await focusedInside('dialog:has(.connection-form-fields)'), 'Modal must block background search shortcuts')
  await page.keyboard.press('Escape')
  await page.locator('dialog[open]').waitFor({ state: 'hidden' })
  assert(await opener.evaluate((element) => element === document.activeElement), 'Closing dialog must restore opener focus')

  const more = page.getByRole('button', { name: 'QA database · Actions', exact: true })
  await more.focus()
  await more.press('Enter')
  await page.locator('.connection-context-menu').waitFor()
  assert(await page.locator('.workspace-tab').count() === 1, 'Enter on More must not open an extra connection')
  await page.keyboard.press('ArrowDown')
  assert(await page.getByRole('menuitem', { name: 'Edit', exact: true }).evaluate((element) => element === document.activeElement), 'Menu arrows must move focus')
  await page.keyboard.press('End')
  assert(await page.getByRole('menuitem', { name: 'Delete', exact: true }).evaluate((element) => element === document.activeElement), 'End must focus last action')
  await page.keyboard.press('Escape')
  assert(await more.evaluate((element) => element === document.activeElement), 'Escape must restore menu opener focus')
  const row = page.locator('.connection-row').filter({ hasText: 'QA database' })
  await row.focus()
  await row.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await expectTrap('dialog:has(.connection-form-fields)')
  await page.keyboard.press('Escape')

  await page.locator('.workspace-tab.active').focus()
  await page.keyboard.press('Home')
  assert(await activeTab() === databaseTab, 'Home must select the first displayed connection tab')
  await page.keyboard.press('ArrowLeft')
  assert(await activeTab() === databaseTab, 'Left must wrap to last workspace tab')
  assert(await page.locator('.workspace-tab.active').evaluate((element) => element === document.activeElement), 'Tab navigation must move focus with selection')
  await page.locator('.brand-home').click()
  assert(await page.locator('.welcome-view').isVisible(), 'Brand button must return to home')
  assert(await page.locator('.workspace-tab[data-tab-id="welcome"]').count() === 0, 'Home must not appear in the tab strip')
  await page.keyboard.press('Control+1')
  assert(await activeTab() === databaseTab, 'Numeric shortcuts must select displayed connection tabs')

  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.result-grid td input').nth(1).click()
  if (await page.locator('.database-action-menu').isVisible()) await page.locator('.database-action-menu summary').click()
  await page.getByRole('button', { name: 'Show full data', exact: true }).click()
  await page.locator('.cell-detail-panel').waitFor()
  assert(await page.locator('.cell-detail-panel textarea').inputValue() === 'complete cell data', 'Cell details must work without a right click')
  await page.locator('.cell-detail-panel').getByRole('button', { name: 'Close this view', exact: true }).click()
  await page.locator('.database-mobile-tabs').getByRole('tab', { name: 'SQL Editor', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.locator('.result-grid td').nth(2).focus()
  await page.keyboard.press('Enter')
  assert(await page.locator('.cell-detail-panel textarea').inputValue() === 'complete cell data', 'Read-only query cells must be keyboard accessible')
  await page.locator('.cell-detail-panel').getByRole('button', { name: 'Close this view', exact: true }).click()
  await opener.click()
  const swatch = await page.locator('.connection-colors button').first().boundingBox()
  assert(swatch.width >= 44 && swatch.height >= 44, 'Mobile color buttons must have a 44px touch target')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile modal must not overflow horizontally')
  assert(await page.locator('.connection-dialog .dialog-actions button').evaluateAll((buttons) => buttons.every((button) => button.scrollWidth <= button.clientWidth)), 'Long action labels must fit their mobile buttons')
  await page.screenshot({ path: '.playwright-cli/second-round-mobile.png' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  assert(await page.locator('#connection-search').evaluate((element) => element === document.activeElement), 'Search shortcut must open the collapsed mobile drawer')
  await page.getByRole('button', { name: 'New group', exact: true }).click()
  await page.getByLabel('Group name', { exact: true }).waitFor()
  await expectTrap('dialog:has(#group-dialog-title)')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Collapse connections', exact: true }).last().click()

  await page.locator('.workspace-tab.active .tab-close').click()
  await page.locator('.workspace-connection-card').filter({ hasText: 'QA password' }).click()
  await page.locator('dialog:has(.ssh-password-dialog)').waitFor()
  assert(await page.locator('.ssh-password-dialog input[type=password]').evaluate((element) => element === document.activeElement), 'SSH password must receive initial focus')
  await expectTrap('dialog:has(.ssh-password-dialog)')
  await page.keyboard.press('Escape')
  await page.locator('dialog[open]').waitFor({ state: 'hidden' })
  await page.locator('.terminal-actions').getByRole('button', { name: 'Reconnect', exact: true }).click()
  await page.locator('.ssh-password-dialog input[type=password]').fill('mock-password')
  await page.locator('.ssh-password-dialog button[type=submit]').click()
  await page.locator('.terminal-status.connected').waitFor()
  await page.evaluate(() => window.qaClipboard.sendData({ sessionId: 'ssh', data: 'QA terminal\r\n' }))
  const terminalMenu = page.locator('.terminal-clipboard-menu')
  await terminalMenu.locator('summary').click()
  await terminalMenu.getByRole('button', { name: 'Select all', exact: true }).click()
  await terminalMenu.locator('summary').click()
  await terminalMenu.getByRole('button', { name: 'Copy', exact: true }).click()
  assert(await page.evaluate(() => window.qaClipboard.copied.includes('QA terminal')), 'Touch menu must copy selected terminal output')
  await terminalMenu.locator('summary').click()
  await terminalMenu.getByRole('button', { name: 'Paste', exact: true }).click()
  await page.waitForFunction(() => window.qaClipboard.writes.join('').includes('echo qa'))
  await page.locator('.workspace-tab.active .tab-close').click()

  await page.locator('.workspace-connection-card').filter({ hasText: 'QA files' }).click()
  await page.getByRole('button', { name: 'notes.txt', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Online text editor', exact: true })
  await editor.fill('unsaved')
  await page.keyboard.press('Escape')
  await page.getByRole('alertdialog').waitFor()
  await expectTrap('dialog[role=alertdialog]')
  await page.keyboard.press('Escape')
  assert(await focusedInside('dialog:has(.sftp-editor)'), 'Cancelling nested confirmation must restore focus to file editor')
  assert(await editor.inputValue() === 'unsaved', 'Nested Escape must retain unsaved file data')
  await page.setViewportSize({ width: 812, height: 375 })
  await page.waitForFunction(() => Math.round(window.visualViewport.height) === Number.parseInt(document.documentElement.style.getPropertyValue('--app-height')))
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  assert(await page.locator('.sftp-editor').evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight), 'Editor actions must fit a short landscape viewport')
  await page.screenshot({ path: '.playwright-cli/second-round-landscape.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard unsaved changes', exact: true }).click()
  await page.locator('dialog[open]').waitFor({ state: 'hidden' })
  assert(errors.length === 0, `Unexpected browser errors: ${errors.join(', ')}`)
  return 'Passed: modal focus/inertness/restore, nested discard, blocked shortcuts, menu keyboard, tab navigation, mobile search/cell details/terminal clipboard, landscape editor'
}
