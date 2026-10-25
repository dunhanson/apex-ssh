import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostConfig } from '@shared/types'

const mocks = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  listHosts: vi.fn()
}))

vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) { return mocks.state.get(key) ?? fallback }
    set(key: string, value: unknown) { mocks.state.set(key, value) }
  }
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: {},
  ipcMain: {},
  safeStorage: { decryptString: (value: Buffer) => value.toString('utf8') }
}))
vi.mock('./hosts', () => ({ listHosts: mocks.listHosts }))
vi.mock('./credentials', () => ({}))

import { syncNow } from './cloud-sync'
import { decryptSyncRecord } from './sync-record-crypto'

// cloud-sync 懒加载 pg 使用 CommonJS，直接拦截同一模块的客户端原型，避免外部连接。
const { Client } = createRequire(import.meta.url)('pg') as typeof import('pg')
const syncKey = 'isolated-sync-test-key'
let directory: string
let uploads: Array<{ id: string; kind: 'host' | 'key'; envelope: unknown }>

describe('云同步本地路径私钥', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'apex-sync-test-'))
    uploads = []
    mocks.state.clear()
    mocks.state.set('enabled', true)
    mocks.state.set('shadow', {})
    mocks.state.set('connection', {
      host: 'unused.invalid', port: 5432, user: 'test', database: 'test',
      passwordBlob: Buffer.from('isolated-password').toString('base64')
    })
    mocks.state.set('syncKeyBlob', Buffer.from(syncKey).toString('base64'))
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined as never)
    vi.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never)
    vi.spyOn(Client.prototype, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT value')) return { rows: [{ value: '1' }] }
      if (sql.includes('INSERT INTO apex_sync_records') && values) {
        uploads.push({ id: values[0] as string, kind: values[1] as 'host' | 'key', envelope: JSON.parse(values[2] as string) })
      }
      return { rows: [] }
    }) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  it.each([true, false])('私钥文件可读=%s 时保持凭证与主机引用一致', async (readable) => {
    const privateKeyPath = join(directory, 'private-key')
    const privateKey = 'isolated-test-private-key'
    if (readable) writeFileSync(privateKeyPath, privateKey)
    const host: HostConfig = {
      id: 'legacy', label: '本地路径私钥', host: 'test.invalid', port: 22, username: 'test',
      auth: { type: 'key', privateKeyPath, passphrase: 'isolated-passphrase' }
    }
    mocks.listHosts.mockReturnValue([host])
    await expect(syncNow()).resolves.toBeNull()
    const decoded = await Promise.all(uploads.map(async (entry) => ({
      ...entry, payload: await decryptSyncRecord(entry.id, entry.kind, entry.envelope, syncKey)
    })))
    const uploadedHost = decoded.find((entry) => entry.kind === 'host')?.payload.data as HostConfig
    expect(uploadedHost.auth).toEqual(readable ? { type: 'key', keyId: 'direct-legacy' } : { type: 'key' })
    expect(decoded.filter((entry) => entry.kind === 'key')).toHaveLength(readable ? 1 : 0)
    if (readable) {
      expect(decoded.find((entry) => entry.kind === 'key')?.payload.data).toMatchObject({
        id: 'direct-legacy', privateKey, passphrase: 'isolated-passphrase'
      })
      expect(JSON.stringify(uploads)).not.toContain(privateKey)
    }
    expect(host.auth).toEqual({ type: 'key', privateKeyPath, passphrase: 'isolated-passphrase' })
  })
})
