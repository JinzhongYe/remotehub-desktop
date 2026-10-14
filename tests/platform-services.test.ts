import { afterEach, describe, expect, it, vi } from 'vitest'
import { appService, sshService } from '../src/services'
import { getTauriPlatform } from '../src/platform/tauri'
import type { RemoteHubPlatform } from '../src/shared/platform'
import type { AppInfo } from '../src/shared/types'

const tauriInvoke = vi.hoisted(() => vi.fn())
const dialogOpen = vi.hoisted(() => vi.fn())
const backButtonPress = vi.hoisted(() => vi.fn())
const eventListen = vi.hoisted(() => vi.fn(async (_name: string, _handler: (event: { payload: unknown }) => void) => () => {}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriInvoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: eventListen }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: backButtonPress }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialogOpen, save: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('platform services', () => {
  it('advertises Android SSH, SFTP and database without desktop-only transfer controls', async () => {
    const platform = getTauriPlatform()
    expect(platform.capabilities).toMatchObject({ connectionManagement: true, ssh: true, sftp: true, database: true, databaseSqlite: false, databaseSshTunnel: false, localFiles: false, sftpTransferControl: false, codexStatus: false })
    expect(platform.connections).toBeDefined()
    expect(platform.ssh).toBeDefined()
    expect(platform.database).toBeDefined()
    expect(await platform.app.getInfo()).toMatchObject({ name: 'RemoteHub', platform: 'android' })
    expect(platform.app.onCloseRequest(vi.fn())).toBeTypeOf('function')
  })

  it('subscribes before SSH connect, routes by session, and acknowledges native output', async () => {
    let ready!: (remove: () => void) => void
    eventListen.mockImplementationOnce(() => new Promise(resolve => { ready = resolve }))
    const ssh = getTauriPlatform().ssh!
    const first = vi.fn(), second = vi.fn()
    const removeFirst = ssh.onData(first, 'first')
    const removeSecond = ssh.onData(second, 'second')
    tauriInvoke.mockResolvedValue({ sessionId: 'first' })
    try {
      const connecting = ssh.connect('server', undefined, 'first')
      await Promise.resolve()
      expect(tauriInvoke).not.toHaveBeenCalled()
      ready(() => undefined)
      await connecting
      expect(tauriInvoke).toHaveBeenCalledWith('ssh_connect', { connectionId: 'server', options: undefined, sessionId: 'first' })
      const dispatch = eventListen.mock.calls[0][1] as (event: { payload: { sessionId: string; data: string; sequence: number } }) => void
      dispatch({ payload: { sessionId: 'first', data: 'banner', sequence: 1 } })
      expect(first).toHaveBeenCalledWith({ sessionId: 'first', data: 'banner', sequence: 1 })
      expect(second).not.toHaveBeenCalled()
      await ssh.acknowledgeOutput('first', 1)
      expect(tauriInvoke).toHaveBeenCalledWith('ssh_acknowledge_output', { sessionId: 'first', sequence: 1 })
      removeFirst()
      dispatch({ payload: { sessionId: 'first', data: 'late', sequence: 2 } })
      expect(first).toHaveBeenCalledTimes(1)
    } finally { removeFirst(); removeSecond() }
  })

  it('uses native clipboard commands on mobile', async () => {
    tauriInvoke.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce('echo test')
    await getTauriPlatform().app.copyText('hello')
    expect(tauriInvoke).toHaveBeenCalledWith('app_copy_text', { text: 'hello' })
    expect(await getTauriPlatform().app.readText()).toBe('echo test')
  })

  it('selects the native iOS provider and stages CSV before native export', async () => {
    vi.stubEnv('TAURI_ENV_PLATFORM', 'ios')
    vi.resetModules()
    const { getPlatform } = await import('../src/platform')
    const platform = getPlatform()
    expect(await platform.app.getInfo()).toMatchObject({ platform: 'ios' })
    tauriInvoke.mockResolvedValueOnce('/cache/sftp-downloads/1/results.csv').mockResolvedValueOnce({ ok: true, canceled: false })
    expect(await platform.database!.exportCsv({ fileName: 'results.csv', columns: ['id'], rows: [[1]] })).toBe('/cache/sftp-downloads/1/results.csv')
    expect(tauriInvoke).toHaveBeenCalledWith('app_download_path', { name: 'results.csv' })
    expect(tauriInvoke).toHaveBeenCalledWith('database_export_csv', expect.objectContaining({ target: '/cache/sftp-downloads/1/results.csv', csv: expect.stringContaining('id') }))
    expect(platform.app.onBackRequest(vi.fn())).toBeTypeOf('function')
  })

  it('maps Android database operations to Tauri commands', async () => {
    tauriInvoke.mockResolvedValueOnce({ kind: 'rows', rows: [] })
    await getTauriPlatform().database!.query('database-1', { sql: 'SELECT 1', page: 0, pageSize: 200 })
    expect(tauriInvoke).toHaveBeenCalledWith('database_query', {
      sessionId: 'database-1', request: { sql: 'SELECT 1', page: 0, pageSize: 200 }
    })
    const request = { database: 'app', table: 'cells', statements: ['DELETE FROM cells WHERE id = 1'] }
    tauriInvoke.mockResolvedValueOnce({ ok: true })
    await expect(getTauriPlatform().database!.applyChanges('database-1', request)).resolves.toEqual({ ok: true })
    expect(tauriInvoke).toHaveBeenCalledWith('database_apply_changes', { sessionId: 'database-1', request })
    tauriInvoke.mockResolvedValueOnce({ columns: ['name'], rows: [['index_1']], hasMore: false })
    await expect(getTauriPlatform().database!.listTableDetails('database-1', 'public', 'cells', 'indexes')).resolves.toMatchObject({ rows: [['index_1']] })
    expect(tauriInvoke).toHaveBeenCalledWith('database_list_table_details', { sessionId: 'database-1', name: 'public', table: 'cells', section: 'indexes' })
  })

  it('uses the native Android back listener and unregisters it cleanly', async () => {
    const unregister = vi.fn(async () => undefined)
    let nativeListener = (): void => undefined
    backButtonPress.mockImplementationOnce(async (listener: () => void) => {
      nativeListener = listener
      return { unregister }
    })
    const listener = vi.fn()
    const stop = getTauriPlatform().app.onBackRequest(listener)
    nativeListener()
    expect(listener).toHaveBeenCalledOnce()
    stop()
    await Promise.resolve()
    nativeListener()
    expect(listener).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('maps Android connection saves to Tauri commands', async () => {
    const request = { connection: { name: 'Server', type: 'ssh' as const, host: 'example.com', port: 22 } }
    tauriInvoke.mockResolvedValueOnce({ id: '1' })
    await getTauriPlatform().connections!.save(request)
    expect(tauriInvoke).toHaveBeenCalledWith('connections_save', { request })
  })

  it('migrates Android WebView settings into native storage once', async () => {
    const legacy = new Map([['remotehub.theme', 'dark']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => legacy.get(key) ?? null,
      removeItem: (key: string) => legacy.delete(key)
    })
    tauriInvoke.mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: true })
    expect(await getTauriPlatform().storage!.get('remotehub.theme')).toBe('dark')
    expect(tauriInvoke).toHaveBeenNthCalledWith(1, 'storage_get', { key: 'remotehub.theme' })
    expect(tauriInvoke).toHaveBeenNthCalledWith(2, 'storage_set', { key: 'remotehub.theme', value: 'dark' })
    expect(legacy.has('remotehub.theme')).toBe(false)
  })

  it('prepares picked uploads and streams downloads to the selected Android URI', async () => {
    dialogOpen.mockResolvedValueOnce(['content://picked/file'])
    tauriInvoke.mockResolvedValueOnce(['/cache/sftp-uploads/1/file.txt'])
    expect(await getTauriPlatform().app.chooseUploadFiles()).toEqual(['/cache/sftp-uploads/1/file.txt'])
    expect(tauriInvoke).toHaveBeenCalledWith('app_prepare_upload_files', { uris: ['content://picked/file'] })

    const result = { transferIds: ['transfer-1'], conflicts: [] }
    tauriInvoke.mockResolvedValueOnce(result)
    await expect(getTauriPlatform().sftp!.enqueueDownload('sftp-1', '/file.txt', 'content://saved/file', 'file')).resolves.toEqual(result)
    expect(tauriInvoke).toHaveBeenCalledWith('sftp_download', {
      sessionId: 'sftp-1', remotePath: '/file.txt', localTarget: 'content://saved/file', entryType: 'file'
    })
  })

  it('resolve the current provider lazily, preserve method receivers and return unsubscribe functions', async () => {
    const firstInfo: AppInfo = { name: 'First', version: '1', platform: 'test', dataPath: '/first' }
    const secondInfo: AppInfo = { name: 'Second', version: '2', platform: 'test', dataPath: '/second' }
    const unsubscribe = vi.fn()
    const listener = vi.fn()
    const first = {
      app: { info: firstInfo, getInfo(this: { info: AppInfo }) { return Promise.resolve(this.info) } },
      ssh: { onData: vi.fn(() => unsubscribe) }
    } as unknown as RemoteHubPlatform
    const second = {
      app: { info: secondInfo, getInfo(this: { info: AppInfo }) { return Promise.resolve(this.info) } }
    } as unknown as RemoteHubPlatform

    vi.stubGlobal('window', { api: first })
    expect(await appService.getInfo()).toEqual(firstInfo)
    expect(sshService.onData(listener, 'session')).toBe(unsubscribe)
    expect(first.ssh.onData).toHaveBeenCalledWith(listener, 'session')

    vi.stubGlobal('window', { api: second })
    expect(await appService.getInfo()).toEqual(secondInfo)
  })

  it('reports a missing platform bridge at the seam', () => {
    vi.stubGlobal('window', {})
    expect(() => appService.onCloseRequest(vi.fn())).toThrow('RemoteHub platform is unavailable')
  })
})
