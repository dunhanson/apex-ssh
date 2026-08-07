import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback
} from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { chmodSync, promises as fsp } from 'node:fs'
import { promisify } from 'node:util'
import type { EncryptedBackupStats, HostConfig } from '@shared/types'

const scrypt = promisify(scryptCallback)
const execFile = promisify(execFileCallback)

export const ENCRYPTED_BACKUP_FORMAT = 'apex-encrypted-backup'
export const ENCRYPTED_BACKUP_VERSION = 1
export const MAX_ENCRYPTED_BACKUP_BYTES = 50 * 1024 * 1024
// Base64 会膨胀约三分之一，为 JSON 容器头预留 4 KB，保证最终文件不超过 50 MB。
const MAX_CIPHERTEXT_BYTES = Math.floor(((MAX_ENCRYPTED_BACKUP_BYTES - 4096) * 3) / 4)
export const SCRYPT_N = 131072
export const SCRYPT_R = 8
export const SCRYPT_P = 1
const SCRYPT_MAXMEM = 256 * 1024 * 1024
const MAX_HOSTS = 10_000
const MAX_CREDENTIALS = 20_000
const MAX_STRING = 1024 * 1024
const MAX_PRIVATE_KEY = 4 * 1024 * 1024

export interface CompletePasswordCredential {
  id: string
  label: string
  password: string
  createdAt: number
}

export interface CompleteKeyCredential {
  id: string
  name: string
  privateKey: string
  passphrase?: string
  createdAt: number
}

export interface CompleteBackupPayload {
  format: 'apex-complete-backup'
  version: 1
  exportedAt: string
  appVersion: string
  stats: EncryptedBackupStats
  hosts: HostConfig[]
  passwords: CompletePasswordCredential[]
  keys: CompleteKeyCredential[]
}

interface EncryptedBackupContainer {
  format: typeof ENCRYPTED_BACKUP_FORMAT
  version: typeof ENCRYPTED_BACKUP_VERSION
  createdAt: string
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

function asObject(value: unknown, message = '备份文件格式无效'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function boundedString(value: unknown, field: string, max = MAX_STRING): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`备份字段 ${field} 无效`)
  return value
}

function requiredString(value: unknown, field: string, max = MAX_STRING): string {
  const result = boundedString(value, field, max)
  if (!result.trim()) throw new Error(`备份字段 ${field} 无效`)
  return result
}

function exactBase64(value: unknown, bytes: number, field: string): string {
  const encoded = requiredString(value, field, Math.ceil(bytes / 3) * 4 + 4)
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length !== bytes || decoded.toString('base64') !== encoded) {
    throw new Error(`备份字段 ${field} 无效`)
  }
  return encoded
}

function aadFor(container: EncryptedBackupContainer): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: container.format,
      version: container.version,
      createdAt: container.createdAt,
      kdf: container.kdf,
      cipher: { name: container.cipher.name, nonce: container.cipher.nonce }
    }),
    'utf8'
  )
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  })) as Buffer
}

export function parseEncryptedContainer(value: unknown): EncryptedBackupContainer {
  const raw = asObject(value)
  if (raw.format !== ENCRYPTED_BACKUP_FORMAT || raw.version !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error('不支持的加密备份格式或版本')
  }
  const kdf = asObject(raw.kdf)
  const cipher = asObject(raw.cipher)
  if (
    kdf.name !== 'scrypt' ||
    kdf.N !== SCRYPT_N ||
    kdf.r !== SCRYPT_R ||
    kdf.p !== SCRYPT_P ||
    cipher.name !== 'aes-256-gcm'
  ) {
    throw new Error('不支持或超出限制的加密参数')
  }
  const ciphertext = requiredString(
    raw.ciphertext,
    'ciphertext',
    Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 + 4
  )
  const ciphertextBuffer = Buffer.from(ciphertext, 'base64')
  if (
    ciphertextBuffer.length > MAX_CIPHERTEXT_BYTES ||
    ciphertextBuffer.toString('base64') !== ciphertext
  ) {
    throw new Error('加密备份内容无效或超过 50 MB')
  }
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    createdAt: requiredString(raw.createdAt, 'createdAt', 64),
    kdf: {
      name: 'scrypt',
      salt: exactBase64(kdf.salt, 16, 'salt'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    },
    cipher: {
      name: 'aes-256-gcm',
      nonce: exactBase64(cipher.nonce, 12, 'nonce'),
      tag: exactBase64(cipher.tag, 16, 'tag')
    },
    ciphertext
  }
}

export async function encryptCompleteBackup(
  payload: CompleteBackupPayload,
  password: string
): Promise<string> {
  if (password.length < 12) throw new Error('备份密码至少需要 12 个字符')
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const key = await deriveKey(password, salt)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  if (plaintext.length > MAX_CIPHERTEXT_BYTES) {
    plaintext.fill(0)
    key.fill(0)
    throw new Error('加密备份文件不能超过 50 MB')
  }
  const container: EncryptedBackupContainer = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    kdf: { name: 'scrypt', salt: salt.toString('base64'), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    cipher: { name: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: '' },
    ciphertext: ''
  }
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(aadFor(container))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    container.cipher.tag = cipher.getAuthTag().toString('base64')
    container.ciphertext = ciphertext.toString('base64')
    ciphertext.fill(0)
    return `${JSON.stringify(container, null, 2)}\n`
  } finally {
    plaintext.fill(0)
    key.fill(0)
    salt.fill(0)
    nonce.fill(0)
  }
}

export async function decryptCompleteBackup(
  value: unknown,
  password: string
): Promise<CompleteBackupPayload> {
  const container = parseEncryptedContainer(value)
  const salt = Buffer.from(container.kdf.salt, 'base64')
  const nonce = Buffer.from(container.cipher.nonce, 'base64')
  const ciphertext = Buffer.from(container.ciphertext, 'base64')
  const key = await deriveKey(password, salt)
  let plaintext: Buffer | null = null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aadFor(container))
    decipher.setAuthTag(Buffer.from(container.cipher.tag, 'base64'))
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return parseCompleteBackupPayload(JSON.parse(plaintext.toString('utf8')))
  } catch {
    throw new Error('备份密码错误或文件已损坏')
  } finally {
    plaintext?.fill(0)
    ciphertext.fill(0)
    key.fill(0)
    salt.fill(0)
    nonce.fill(0)
  }
}

function parseHost(rawValue: unknown, index: number): HostConfig {
  const raw = asObject(rawValue, `第 ${index + 1} 条主机配置无效`)
  const port = raw.port
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
    throw new Error(`第 ${index + 1} 条主机端口无效`)
  }
  const auth = asObject(raw.auth, `第 ${index + 1} 条主机认证配置无效`)
  const base = {
    id: requiredString(raw.id, 'host.id', 128),
    label: boundedString(raw.label, 'host.label', 1024),
    ...(typeof raw.description === 'string' && raw.description
      ? { description: boundedString(raw.description, 'host.description', 4096) }
      : {}),
    host: requiredString(raw.host, 'host.host', 1024),
    port: port as number,
    username: requiredString(raw.username, 'host.username', 1024),
    ...(typeof raw.group === 'string' && raw.group
      ? { group: boundedString(raw.group, 'host.group', 1024) }
      : {})
  }
  if (auth.type === 'password') {
    return {
      ...base,
      auth: {
        type: 'password',
        ...(typeof auth.passwordId === 'string' && auth.passwordId
          ? { passwordId: requiredString(auth.passwordId, 'host.passwordId', 128) }
          : {})
      }
    }
  }
  if (auth.type === 'key') {
    return {
      ...base,
      auth: {
        type: 'key',
        ...(typeof auth.keyId === 'string' && auth.keyId
          ? { keyId: requiredString(auth.keyId, 'host.keyId', 128) }
          : {})
      }
    }
  }
  throw new Error(`第 ${index + 1} 条主机认证配置无效`)
}

export function parseCompleteBackupPayload(value: unknown): CompleteBackupPayload {
  const raw = asObject(value)
  if (raw.format !== 'apex-complete-backup' || raw.version !== 1) {
    throw new Error('不支持的完整备份载荷格式或版本')
  }
  if (!Array.isArray(raw.hosts) || raw.hosts.length > MAX_HOSTS) {
    throw new Error('完整备份中的主机数量无效')
  }
  if (!Array.isArray(raw.passwords) || raw.passwords.length > MAX_CREDENTIALS) {
    throw new Error('完整备份中的密码数量无效')
  }
  if (!Array.isArray(raw.keys) || raw.keys.length > MAX_CREDENTIALS) {
    throw new Error('完整备份中的私钥数量无效')
  }
  const hosts = raw.hosts.map(parseHost)
  const hostIds = new Set(hosts.map((entry) => entry.id))
  if (hostIds.size !== hosts.length) throw new Error('完整备份中存在重复主机 ID')
  const passwords = raw.passwords.map((value, index): CompletePasswordCredential => {
    const entry = asObject(value, `第 ${index + 1} 条密码凭证无效`)
    return {
      id: requiredString(entry.id, 'password.id', 128),
      label: boundedString(entry.label, 'password.label', 1024),
      password: boundedString(entry.password, 'password.value'),
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0
    }
  })
  const keys = raw.keys.map((value, index): CompleteKeyCredential => {
    const entry = asObject(value, `第 ${index + 1} 条私钥凭证无效`)
    return {
      id: requiredString(entry.id, 'key.id', 128),
      name: boundedString(entry.name, 'key.name', 1024),
      privateKey: requiredString(entry.privateKey, 'key.privateKey', MAX_PRIVATE_KEY),
      ...(typeof entry.passphrase === 'string' && entry.passphrase
        ? { passphrase: boundedString(entry.passphrase, 'key.passphrase') }
        : {}),
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0
    }
  })
  if (new Set(passwords.map((entry) => entry.id)).size !== passwords.length) {
    throw new Error('完整备份中存在重复密码 ID')
  }
  if (new Set(keys.map((entry) => entry.id)).size !== keys.length) {
    throw new Error('完整备份中存在重复私钥 ID')
  }
  const passwordIds = new Set(passwords.map((entry) => entry.id))
  const keyIds = new Set(keys.map((entry) => entry.id))
  for (const host of hosts) {
    if (host.auth.type === 'password' && host.auth.passwordId && !passwordIds.has(host.auth.passwordId)) {
      throw new Error('完整备份包含无法解析的密码引用')
    }
    if (host.auth.type === 'key' && host.auth.keyId && !keyIds.has(host.auth.keyId)) {
      throw new Error('完整备份包含无法解析的私钥引用')
    }
  }
  const stats: EncryptedBackupStats = {
    hosts: hosts.length,
    passwords: passwords.length,
    keys: keys.length,
    passphrases: keys.filter((entry) => !!entry.passphrase).length
  }
  return {
    format: 'apex-complete-backup',
    version: 1,
    exportedAt: requiredString(raw.exportedAt, 'exportedAt', 64),
    appVersion: boundedString(raw.appVersion, 'appVersion', 64),
    stats,
    hosts,
    passwords,
    keys
  }
}

async function getWindowsUserSid(): Promise<string> {
  const { stdout } = await execFile('whoami', ['/user', '/fo', 'csv', '/nh'], {
    windowsHide: true
  })
  const sid = stdout.trim().match(/,"(S-\d+(?:-\d+)*)"$/i)?.[1]
  if (!sid) throw new Error('无法获取当前 Windows 用户 SID')
  return sid
}

async function grantWindowsBackupFileControl(path: string, removeInheritance: boolean): Promise<void> {
  const sid = await getWindowsUserSid()
  const args = [path]
  if (removeInheritance) args.push('/inheritance:r')
  args.push('/grant:r', `*${sid}:(F)`)
  await execFile('icacls', args, {
    windowsHide: true
  })
}

/** 限制完整备份文件仅当前用户可读写；Windows 使用 SID 移除继承 ACL。 */
export async function restrictBackupFilePermissions(path: string): Promise<void> {
  chmodSync(path, 0o600)
  if (process.platform !== 'win32') return
  await grantWindowsBackupFileControl(path, true)
}

async function prepareBackupFileForOverwrite(path: string): Promise<void> {
  try {
    await fsp.access(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  if (process.platform === 'win32') {
    await grantWindowsBackupFileControl(path, false)
  } else {
    chmodSync(path, 0o600)
  }
}

export async function writeEncryptedBackupFile(path: string, encrypted: string): Promise<void> {
  await prepareBackupFileForOverwrite(path)
  await fsp.writeFile(path, encrypted, { encoding: 'utf8', mode: 0o600 })
  try {
    await restrictBackupFilePermissions(path)
  } catch (error) {
    await fsp.rm(path, { force: true })
    throw error
  }
}
