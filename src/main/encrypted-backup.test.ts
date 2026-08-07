import { describe, expect, it } from 'vitest'
import {
  decryptCompleteBackup,
  encryptCompleteBackup,
  parseCompleteBackupPayload,
  parseEncryptedContainer,
  type CompleteBackupPayload
} from './encrypted-backup'

const password = 'correct horse battery staple'

function payload(): CompleteBackupPayload {
  return {
    format: 'apex-complete-backup',
    version: 1,
    exportedAt: '2026-08-07T00:00:00.000Z',
    appVersion: '0.1.0',
    stats: { hosts: 1, passwords: 1, keys: 0, passphrases: 0 },
    hosts: [
      {
        id: 'host-1',
        label: '生产机',
        host: '192.0.2.10',
        port: 22,
        username: 'root',
        auth: { type: 'password', passwordId: 'password-1' }
      }
    ],
    passwords: [
      {
        id: 'password-1',
        label: '生产机',
        password: 'top-secret-password',
        createdAt: 1
      }
    ],
    keys: []
  }
}

describe('加密完整备份容器', () => {
  it('使用正确密码完成往返，且容器不包含业务明文', async () => {
    const encrypted = await encryptCompleteBackup(payload(), password)

    expect(encrypted).not.toContain('top-secret-password')
    expect(encrypted).not.toContain('192.0.2.10')
    await expect(decryptCompleteBackup(JSON.parse(encrypted), password)).resolves.toEqual(payload())
  })

  it('相同载荷连续导出的密文不同', async () => {
    const first = await encryptCompleteBackup(payload(), password)
    const second = await encryptCompleteBackup(payload(), password)

    expect(first).not.toBe(second)
  })

  it('统一拒绝错误密码和被篡改的密文', async () => {
    const encrypted = JSON.parse(await encryptCompleteBackup(payload(), password))
    await expect(decryptCompleteBackup(encrypted, 'this password is wrong')).rejects.toThrow(
      '备份密码错误或文件已损坏'
    )

    const bytes = Buffer.from(encrypted.ciphertext, 'base64')
    bytes[0] ^= 1
    encrypted.ciphertext = bytes.toString('base64')
    await expect(decryptCompleteBackup(encrypted, password)).rejects.toThrow(
      '备份密码错误或文件已损坏'
    )
  })

  it('认证容器头并拒绝未知版本和超限参数', async () => {
    const encrypted = JSON.parse(await encryptCompleteBackup(payload(), password))
    encrypted.createdAt = '2026-08-08T00:00:00.000Z'
    await expect(decryptCompleteBackup(encrypted, password)).rejects.toThrow(
      '备份密码错误或文件已损坏'
    )

    encrypted.version = 2
    expect(() => parseEncryptedContainer(encrypted)).toThrow('不支持的加密备份格式或版本')
    encrypted.version = 1
    encrypted.kdf.N = 262144
    expect(() => parseEncryptedContainer(encrypted)).toThrow('不支持或超出限制的加密参数')
  })

  it('在写入前拒绝重复 ID、悬空引用和载荷中的直填秘密', () => {
    const duplicate = payload()
    duplicate.passwords.push({ ...duplicate.passwords[0] })
    expect(() => parseCompleteBackupPayload(duplicate)).toThrow('重复密码 ID')

    const unresolved = payload()
    unresolved.hosts[0].auth = { type: 'password', passwordId: 'missing' }
    expect(() => parseCompleteBackupPayload(unresolved)).toThrow('无法解析的密码引用')

    const injected = payload() as unknown as {
      hosts: Array<{ auth: { type: 'password'; password?: string; passwordId?: string } }>
    }
    injected.hosts[0].auth.password = 'must-not-survive'
    const parsed = parseCompleteBackupPayload(injected)
    expect(parsed.hosts[0].auth).toEqual({ type: 'password', passwordId: 'password-1' })
  })
})
