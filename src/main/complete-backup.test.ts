import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteBackupPayload } from './encrypted-backup'

const mocks = vi.hoisted(() => ({
  importCompleteCredentials: vi.fn(),
  rollbackImportedCredentials: vi.fn(),
  importHosts: vi.fn(),
  listHosts: vi.fn(),
  listKeys: vi.fn(),
  restoreHostsSnapshot: vi.fn()
}))

vi.mock('electron', () => ({ app: { getVersion: () => '0.1.0' } }))
vi.mock('./credentials', () => ({
  exportKeyCredential: vi.fn(),
  exportPasswordCredential: vi.fn(),
  importCompleteCredentials: mocks.importCompleteCredentials,
  listKeys: mocks.listKeys,
  rollbackImportedCredentials: mocks.rollbackImportedCredentials
}))
vi.mock('./hosts', () => ({
  importHosts: mocks.importHosts,
  listHosts: mocks.listHosts,
  restoreHostsSnapshot: mocks.restoreHostsSnapshot
}))

import { getCompleteBackupStats, importCompleteBackupPayload } from './complete-backup'

function payload(): CompleteBackupPayload {
  return {
    format: 'apex-complete-backup',
    version: 1,
    exportedAt: '2026-08-07T00:00:00.000Z',
    appVersion: '0.1.0',
    stats: { hosts: 2, passwords: 1, keys: 1, passphrases: 1 },
    hosts: [
      {
        id: 'password-host',
        label: '密码主机',
        host: '192.0.2.1',
        port: 22,
        username: 'root',
        auth: { type: 'password', passwordId: 'password-conflict' }
      },
      {
        id: 'key-host',
        label: '密钥主机',
        host: '192.0.2.2',
        port: 22,
        username: 'root',
        auth: { type: 'key', keyId: 'key-conflict' }
      }
    ],
    passwords: [
      { id: 'password-conflict', label: '密码', password: 'secret', createdAt: 1 }
    ],
    keys: [
      {
        id: 'key-conflict',
        name: '密钥',
        privateKey: 'private-key',
        passphrase: 'passphrase',
        createdAt: 1
      }
    ]
  }
}

describe('完整备份导入事务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listHosts.mockReturnValue([{ id: 'local-host' }])
    mocks.listKeys.mockReturnValue([])
    mocks.importCompleteCredentials.mockResolvedValue({
      passwordIdMap: new Map([['password-conflict', 'password-remapped']]),
      keyIdMap: new Map([['key-conflict', 'key-remapped']]),
      createdPasswordIds: ['password-remapped'],
      createdKeyIds: ['key-remapped']
    })
    mocks.importHosts.mockReturnValue({ added: 2, updated: 0 })
  })

  it('凭证冲突时改写导入主机引用，不覆盖原 ID', async () => {
    await expect(importCompleteBackupPayload(payload(), 'merge')).resolves.toEqual({
      added: 2,
      updated: 0
    })

    const importedHosts = mocks.importHosts.mock.calls[0][0]
    expect(importedHosts[0].auth).toEqual({
      type: 'password',
      passwordId: 'password-remapped'
    })
    expect(importedHosts[1].auth).toEqual({ type: 'key', keyId: 'key-remapped' })
  })

  it('预览只按引用和安全元数据统计凭证', () => {
    mocks.listHosts.mockReturnValue(payload().hosts)
    mocks.listKeys.mockReturnValue([{ id: 'key-conflict', hasPassphrase: true }])

    expect(getCompleteBackupStats()).toEqual({
      hosts: 2,
      passwords: 1,
      keys: 1,
      passphrases: 1
    })
  })

  it('主机写入失败时恢复快照并撤销新凭证', async () => {
    const failure = new Error('write failed')
    mocks.importHosts.mockImplementation(() => {
      throw failure
    })

    await expect(importCompleteBackupPayload(payload(), 'replace')).rejects.toBe(failure)
    expect(mocks.restoreHostsSnapshot).toHaveBeenCalledWith([{ id: 'local-host' }])
    expect(mocks.rollbackImportedCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        createdPasswordIds: ['password-remapped'],
        createdKeyIds: ['key-remapped']
      })
    )
  })
})
