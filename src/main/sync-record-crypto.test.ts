import { describe, expect, it } from 'vitest'
import {
  SYNC_KEY_ERROR,
  SYNC_RECORD_FORMAT,
  decryptSyncRecord,
  encryptSyncRecord,
  generateSyncKey,
  parseSyncRecordEnvelope
} from './sync-record-crypto'

const KEY = 'test-sync-key-24chars!!'
const RECORD_ID = 'host:9b1d8d2e-0000-4000-8000-000000000001'

function payload() {
  return {
    updatedAt: 1723000000000,
    data: { id: 'h1', label: '生产服务器', host: '10.0.0.8', secret: 'top-secret-password' }
  }
}

describe('sync-record-crypto', () => {
  it('使用正确密钥完成往返，且容器不包含业务明文', async () => {
    const envelope = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    const serialized = JSON.stringify(envelope)
    expect(serialized).not.toContain('top-secret-password')
    expect(serialized).not.toContain('生产服务器')
    expect(serialized).not.toContain('10.0.0.8')
    await expect(decryptSyncRecord(RECORD_ID, 'host', envelope, KEY)).resolves.toEqual(payload())
  })

  it('同一记录两次加密得到不同密文', async () => {
    const first = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    const second = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.cipher.nonce).not.toBe(second.cipher.nonce)
  })

  it('错误密钥统一报错', async () => {
    const envelope = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    await expect(decryptSyncRecord(RECORD_ID, 'host', envelope, 'wrong-key')).rejects.toThrow(
      SYNC_KEY_ERROR
    )
  })

  it('篡改密文或认证标签被拒绝', async () => {
    const envelope = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    const raw = Buffer.from(envelope.ciphertext, 'base64')
    raw[0] = raw[0] ^ 0xff
    await expect(
      decryptSyncRecord(RECORD_ID, 'host', { ...envelope, ciphertext: raw.toString('base64') }, KEY)
    ).rejects.toThrow(SYNC_KEY_ERROR)

    const tag = Buffer.from(envelope.cipher.tag, 'base64')
    tag[0] = tag[0] ^ 0xff
    const tamperedTag = {
      ...envelope,
      cipher: { ...envelope.cipher, tag: tag.toString('base64') }
    }
    await expect(decryptSyncRecord(RECORD_ID, 'host', tamperedTag, KEY)).rejects.toThrow(
      SYNC_KEY_ERROR
    )
  })

  it('recordId 或 kind 不匹配时解密失败（AAD 绑定）', async () => {
    const envelope = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    await expect(decryptSyncRecord('host:other-id', 'host', envelope, KEY)).rejects.toThrow(
      SYNC_KEY_ERROR
    )
    await expect(decryptSyncRecord(RECORD_ID, 'password', envelope, KEY)).rejects.toThrow(
      SYNC_KEY_ERROR
    )
  })

  it('篡改容器头（format / kdf 参数）被拒绝', async () => {
    const envelope = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    expect(() => parseSyncRecordEnvelope({ ...envelope, format: 'other' })).toThrow(SYNC_KEY_ERROR)
    expect(() =>
      parseSyncRecordEnvelope({ ...envelope, kdf: { ...envelope.kdf, N: 1024 } })
    ).toThrow(SYNC_KEY_ERROR)
    await expect(
      decryptSyncRecord(RECORD_ID, 'host', { ...envelope, format: 'other' }, KEY)
    ).rejects.toThrow(SYNC_KEY_ERROR)
  })

  it('拒绝非对象与超长字段', async () => {
    expect(() => parseSyncRecordEnvelope(null)).toThrow(SYNC_KEY_ERROR)
    expect(() => parseSyncRecordEnvelope('string')).toThrow(SYNC_KEY_ERROR)
    const envelope = await encryptSyncRecord(RECORD_ID, 'host', payload(), KEY)
    expect(() =>
      parseSyncRecordEnvelope({ ...envelope, ciphertext: 'A'.repeat(9 * 1024 * 1024) })
    ).toThrow(SYNC_KEY_ERROR)
  })

  it('格式与版本常量固定', () => {
    expect(SYNC_RECORD_FORMAT).toBe('apex-sync-record')
  })

  it('生成 24 位随机同步密钥：覆盖四类字符且排除易混淆字符', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 32; i += 1) {
      const key = generateSyncKey()
      expect(key).toHaveLength(24)
      expect(key).toMatch(/[A-HJ-NP-Z]/)
      expect(key).toMatch(/[a-km-z]/)
      expect(key).toMatch(/[2-9]/)
      expect(key).toMatch(/[!@#$%^&*_-]/)
      expect(key).not.toMatch(/[O0Il1]/)
      seen.add(key)
    }
    expect(seen.size).toBe(32)
  })

  it('非法密钥长度抛出 RangeError', () => {
    expect(() => generateSyncKey(3)).toThrow(RangeError)
    expect(() => generateSyncKey(2.5)).toThrow(RangeError)
  })
})
