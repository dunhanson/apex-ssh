import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback
} from 'node:crypto'
import { promisify } from 'node:util'
import { SCRYPT_N, SCRYPT_R, SCRYPT_P } from './encrypted-backup'

const scrypt = promisify(scryptCallback)

/**
 * 云同步记录级加密容器：每条记录独立盐与 nonce，recordId / kind 作为 AAD，
 * 防止记录在数据库内被调换、篡改或跨记录拼接。算法参数与加密完整备份一致。
 * 同步密钥只在主进程内存中使用，永不落盘明文、永不回传渲染进程。
 */
export const SYNC_RECORD_FORMAT = 'apex-sync-record'
export const SYNC_RECORD_VERSION = 1
export const SYNC_KEY_LENGTH = 24
export const SYNC_KEY_ERROR = '同步密钥错误或云端数据已损坏'

const SCRYPT_MAXMEM = 256 * 1024 * 1024
// 单条记录上限：私钥最大 4 MB，预留载荷包装开销
const MAX_RECORD_PLAINTEXT_BYTES = 6 * 1024 * 1024
const MAX_RECORD_CIPHERTEXT_B64 = Math.ceil(MAX_RECORD_PLAINTEXT_BYTES / 3) * 4 + 4

export type SyncRecordKind = 'host' | 'password' | 'key'

export interface SyncRecordPayload {
  /** 记录级最后修改时间（ms epoch），与数据库 updated_at 列一致 */
  updatedAt: number
  /** 业务数据：HostConfig / CompletePasswordCredential / CompleteKeyCredential */
  data: unknown
}

export interface SyncRecordEnvelope {
  format: typeof SYNC_RECORD_FORMAT
  version: typeof SYNC_RECORD_VERSION
  kdf: {
    name: 'scrypt'
    salt: string
    N: typeof SCRYPT_N
    r: typeof SCRYPT_R
    p: typeof SCRYPT_P
  }
  cipher: {
    name: 'aes-256-gcm'
    nonce: string
    tag: string
  }
  ciphertext: string
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function exactBase64(value: unknown, bytes: number): string {
  if (typeof value !== 'string') throw new Error(SYNC_KEY_ERROR)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== bytes || decoded.toString('base64') !== value) {
    throw new Error(SYNC_KEY_ERROR)
  }
  return value
}

function aadFor(recordId: string, kind: SyncRecordKind, envelope: SyncRecordEnvelope): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: envelope.format,
      version: envelope.version,
      recordId,
      kind,
      kdf: envelope.kdf,
      cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce }
    }),
    'utf8'
  )
}

async function deriveKey(syncKey: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(syncKey, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  })) as Buffer
}

/** 严格校验云端读取的加密容器；任何字段异常统一按密钥/数据错误处理 */
export function parseSyncRecordEnvelope(value: unknown): SyncRecordEnvelope {
  const raw = asObject(value, SYNC_KEY_ERROR)
  if (raw.format !== SYNC_RECORD_FORMAT || raw.version !== SYNC_RECORD_VERSION) {
    throw new Error(SYNC_KEY_ERROR)
  }
  const kdf = asObject(raw.kdf, SYNC_KEY_ERROR)
  const cipher = asObject(raw.cipher, SYNC_KEY_ERROR)
  if (
    kdf.name !== 'scrypt' ||
    kdf.N !== SCRYPT_N ||
    kdf.r !== SCRYPT_R ||
    kdf.p !== SCRYPT_P ||
    cipher.name !== 'aes-256-gcm'
  ) {
    throw new Error(SYNC_KEY_ERROR)
  }
  if (typeof raw.ciphertext !== 'string' || raw.ciphertext.length > MAX_RECORD_CIPHERTEXT_B64) {
    throw new Error(SYNC_KEY_ERROR)
  }
  const ciphertext = Buffer.from(raw.ciphertext, 'base64')
  if (
    ciphertext.length > MAX_RECORD_PLAINTEXT_BYTES + 16 ||
    ciphertext.toString('base64') !== raw.ciphertext
  ) {
    throw new Error(SYNC_KEY_ERROR)
  }
  return {
    format: SYNC_RECORD_FORMAT,
    version: SYNC_RECORD_VERSION,
    kdf: {
      name: 'scrypt',
      salt: exactBase64(kdf.salt, 16),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    },
    cipher: {
      name: 'aes-256-gcm',
      nonce: exactBase64(cipher.nonce, 12),
      tag: exactBase64(cipher.tag, 16)
    },
    ciphertext: raw.ciphertext
  }
}

export async function encryptSyncRecord(
  recordId: string,
  kind: SyncRecordKind,
  payload: SyncRecordPayload,
  syncKey: string
): Promise<SyncRecordEnvelope> {
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const key = await deriveKey(syncKey, salt)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  if (plaintext.length > MAX_RECORD_PLAINTEXT_BYTES) {
    plaintext.fill(0)
    key.fill(0)
    salt.fill(0)
    nonce.fill(0)
    throw new Error('单条同步记录不能超过 6 MB')
  }
  const envelope: SyncRecordEnvelope = {
    format: SYNC_RECORD_FORMAT,
    version: SYNC_RECORD_VERSION,
    kdf: { name: 'scrypt', salt: salt.toString('base64'), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    cipher: { name: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: '' },
    ciphertext: ''
  }
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(aadFor(recordId, kind, envelope))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    envelope.cipher.tag = cipher.getAuthTag().toString('base64')
    envelope.ciphertext = ciphertext.toString('base64')
    ciphertext.fill(0)
    return envelope
  } finally {
    plaintext.fill(0)
    key.fill(0)
    salt.fill(0)
    nonce.fill(0)
  }
}

/** 解密失败（密钥错误、记录被篡改或 AAD 不匹配）统一抛出 SYNC_KEY_ERROR */
export async function decryptSyncRecord(
  recordId: string,
  kind: SyncRecordKind,
  value: unknown,
  syncKey: string
): Promise<SyncRecordPayload> {
  const envelope = parseSyncRecordEnvelope(value)
  const salt = Buffer.from(envelope.kdf.salt, 'base64')
  const nonce = Buffer.from(envelope.cipher.nonce, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const key = await deriveKey(syncKey, salt)
  let plaintext: Buffer | null = null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aadFor(recordId, kind, envelope))
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'))
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const parsed = asObject(JSON.parse(plaintext.toString('utf8')), SYNC_KEY_ERROR)
    if (typeof parsed.updatedAt !== 'number' || !Number.isFinite(parsed.updatedAt)) {
      throw new Error(SYNC_KEY_ERROR)
    }
    return { updatedAt: parsed.updatedAt, data: parsed.data }
  } catch {
    throw new Error(SYNC_KEY_ERROR)
  } finally {
    plaintext?.fill(0)
    ciphertext.fill(0)
    key.fill(0)
    salt.fill(0)
    nonce.fill(0)
  }
}

// 与渲染端 T-009 随机密码同一字符集风格：排除易混淆字符，四类字符各至少一位
const KEY_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*_-'
] as const
const KEY_ALPHABET = KEY_GROUPS.join('')

function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  let value: number
  do {
    value = randomBytes(4).readUInt32BE(0)
  } while (value >= limit)
  return value % max
}

/** 生成 24 位随机同步密钥（每个用户独立随机，应用不内置共享密钥） */
export function generateSyncKey(length = SYNC_KEY_LENGTH): string {
  if (!Number.isInteger(length) || length < KEY_GROUPS.length) {
    throw new RangeError(`同步密钥长度必须是至少 ${KEY_GROUPS.length} 的整数`)
  }
  const characters = KEY_GROUPS.map((group) => group[randomIndex(group.length)])
  while (characters.length < length) {
    characters.push(KEY_ALPHABET[randomIndex(KEY_ALPHABET.length)])
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    ;[characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]]
  }
  return characters.join('')
}
