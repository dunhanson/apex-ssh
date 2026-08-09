import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { KeyEntry, PasswordMeta } from '@shared/types'
import type {
  CompleteKeyCredential,
  CompletePasswordCredential
} from './encrypted-backup'
import { listHosts } from './hosts'

/**
 * 凭证库：密钥（ssh-keygen 真实生成 / 导入）与密码（safeStorage 加密落盘）。
 * 私钥文件统一收进 userData/keys/<id>[.pub]；store 只存元数据与密文，
 * 明文密码只在主进程连接时解密使用，永不回传渲染端。
 */
const execFileAsync = promisify(execFile)

interface KeyRecord extends KeyEntry {
  /** userData/keys/ 下的私钥文件名（不含目录） */
  file: string
  /** 私钥口令的 safeStorage 密文；只在主进程连接或完整备份时解密 */
  passphraseBlob?: string
}

interface PasswordRecord extends PasswordMeta {
  /** safeStorage 密文 base64 */
  blob: string
}

const store = new Store<{ keys: KeyRecord[]; passwords: PasswordRecord[] }>({
  // conf 无法从 CJS 主进程推断包名，需显式指定；electron-store v11 类型定义未暴露该字段，运行时有效
  // @ts-expect-error projectName 在 conf v15 运行时有效
  projectName: 'apex-ssh',
  name: 'apex-credentials',
  defaults: { keys: [], passwords: [] }
})

const keysDir = (): string => {
  const dir = join(app.getPath('userData'), 'keys')
  mkdirSync(dir, { recursive: true })
  return dir
}

const allKeys = (): KeyRecord[] => store.get('keys', [])
const allPasswords = (): PasswordRecord[] => store.get('passwords', [])

/** ssh-keygen -lf 输出 "<bits> <fingerprint> <comment> (<type>)"，取指纹段 */
async function fingerprintOf(pubPath: string): Promise<string> {
  const { stdout } = await execFileAsync('ssh-keygen', ['-lf', pubPath])
  return stdout.trim().split(/\s+/)[1] ?? ''
}

/** OpenSSH 拒绝读取可被其他 Windows 账户访问的私钥，需移除继承 ACL。 */
async function restrictPrivateKeyPermissions(privPath: string): Promise<void> {
  chmodSync(privPath, 0o600)
  if (process.platform !== 'win32') return

  const { stdout } = await execFileAsync('whoami', ['/user', '/fo', 'csv', '/nh'], {
    windowsHide: true
  })
  const sid = stdout.trim().match(/,"(S-\d+(?:-\d+)*)"$/i)?.[1]
  if (!sid) throw new Error('无法获取当前 Windows 用户 SID')

  await execFileAsync(
    'icacls',
    [privPath, '/inheritance:r', '/grant:r', `*${sid}:(R)`],
    { windowsHide: true }
  )
}

export function listKeys(): KeyEntry[] {
  return allKeys().map(toKeyEntry)
}

function toKeyEntry({ file: _file, passphraseBlob: _passphraseBlob, ...meta }: KeyRecord): KeyEntry {
  return meta
}

/** 生成 Ed25519 密钥对（系统 ssh-keygen，Windows 10+ 自带 OpenSSH 客户端） */
export async function generateKey(name: string): Promise<{ entry: KeyEntry } | { error: string }> {
  const id = randomUUID()
  const privPath = join(keysDir(), id)
  try {
    await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-f', privPath, '-N', '', '-C', name])
    await restrictPrivateKeyPermissions(privPath)
    const fingerprint = await fingerprintOf(`${privPath}.pub`)
    const record: KeyRecord = {
      id,
      name,
      fingerprint,
      publicKey: readFileSync(`${privPath}.pub`, 'utf-8').trim(),
      file: id,
      createdAt: Date.now()
    }
    store.set('keys', [...allKeys(), record])
    return { entry: toKeyEntry(record) }
  } catch (err) {
    rmSync(privPath, { force: true })
    rmSync(`${privPath}.pub`, { force: true })
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** 导入本地私钥：复制进密钥库，派生公钥与指纹（暂不支持带口令的私钥） */
export async function importKey(
  name: string,
  sourcePath: string
): Promise<{ entry: KeyEntry } | { error: string }> {
  const id = randomUUID()
  const privPath = join(keysDir(), id)
  try {
    copyFileSync(sourcePath, privPath)
    await restrictPrivateKeyPermissions(privPath)
    const { stdout: pub } = await execFileAsync('ssh-keygen', ['-y', '-P', '', '-f', privPath])
    writeFileSync(`${privPath}.pub`, pub.trim() + '\n')
    const fingerprint = await fingerprintOf(`${privPath}.pub`)
    const record: KeyRecord = {
      id,
      name,
      fingerprint,
      publicKey: pub.trim(),
      file: id,
      createdAt: Date.now()
    }
    store.set('keys', [...allKeys(), record])
    return { entry: toKeyEntry(record) }
  } catch (err) {
    rmSync(privPath, { force: true })
    rmSync(`${privPath}.pub`, { force: true })
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function removeFileQuietly(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // 清理候选或备份文件失败不应覆盖主要操作结果。
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function restoreBackup(backupPath: string, targetPath: string): string | null {
  if (!existsSync(backupPath)) return null
  try {
    renameSync(backupPath, targetPath)
    return null
  } catch (error) {
    return `${errorMessage(error)}（原文件保留在 ${backupPath}）`
  }
}

/**
 * 原位替换私钥并保留条目 ID：候选文件校验完成后才交换正式文件，
 * 交换或元数据写入失败时恢复原私钥和公钥。
 */
export async function replaceKey(
  id: string,
  sourcePath: string
): Promise<{ entry: KeyEntry } | { error: string }> {
  const keys = allKeys()
  const index = keys.findIndex((key) => key.id === id)
  if (index < 0) return { error: '密钥不存在' }

  const record = keys[index]
  const privPath = join(keysDir(), record.file)
  const pubPath = `${privPath}.pub`
  const token = randomUUID()
  const candidatePriv = `${privPath}.replace-${token}`
  const candidatePub = `${candidatePriv}.pub`
  const backupPriv = `${privPath}.backup-${token}`
  const backupPub = `${pubPath}.backup-${token}`
  let privateBackedUp = false
  let publicBackedUp = false
  let candidatePrivateInstalled = false
  let candidatePublicInstalled = false

  try {
    copyFileSync(sourcePath, candidatePriv)
    await restrictPrivateKeyPermissions(candidatePriv)
    const { stdout: pub } = await execFileAsync('ssh-keygen', [
      '-y',
      '-P',
      '',
      '-f',
      candidatePriv
    ])
    writeFileSync(candidatePub, pub.trim() + '\n')
    const fingerprint = await fingerprintOf(candidatePub)

    renameSync(privPath, backupPriv)
    privateBackedUp = true
    if (existsSync(pubPath)) {
      renameSync(pubPath, backupPub)
      publicBackedUp = true
    }

    renameSync(candidatePriv, privPath)
    candidatePrivateInstalled = true
    renameSync(candidatePub, pubPath)
    candidatePublicInstalled = true
    const nextRecord: KeyRecord = {
      ...record,
      fingerprint,
      publicKey: pub.trim(),
      hasPassphrase: false,
      passphraseBlob: undefined
    }
    keys[index] = nextRecord
    store.set('keys', keys)
    removeFileQuietly(backupPriv)
    removeFileQuietly(backupPub)
    return { entry: toKeyEntry(nextRecord) }
  } catch (err) {
    removeFileQuietly(candidatePriv)
    removeFileQuietly(candidatePub)
    if (candidatePrivateInstalled) removeFileQuietly(privPath)
    if (candidatePublicInstalled) removeFileQuietly(pubPath)

    const restoreErrors = [
      privateBackedUp ? restoreBackup(backupPriv, privPath) : null,
      publicBackedUp ? restoreBackup(backupPub, pubPath) : null
    ].filter((message): message is string => Boolean(message))
    const restoreSuffix =
      restoreErrors.length > 0 ? `；恢复原密钥失败：${restoreErrors.join('；')}` : ''
    return { error: `${errorMessage(err)}${restoreSuffix}` }
  }
}

/** 修改密钥显示名称；文件名和主机引用 ID 保持不变。 */
export function renameKey(id: string, name: string): string | null {
  const nextName = name.trim()
  if (!nextName) return '密钥名称不能为空'
  const keys = allKeys()
  const index = keys.findIndex((key) => key.id === id)
  if (index < 0) return '密钥不存在'
  keys[index] = { ...keys[index], name: nextName }
  store.set('keys', keys)
  return null
}

/** 删除密钥；被主机引用时拒绝并返回引用主机名 */
export function deleteKey(id: string): string | null {
  const referenced = listHosts()
    .filter((h) => h.auth.type === 'key' && h.auth.keyId === id)
    .map((h) => h.label || `${h.username}@${h.host}`)
  if (referenced.length > 0) return `密钥正被主机引用：${referenced.join('、')}`
  const record = allKeys().find((k) => k.id === id)
  if (record) {
    rmSync(join(keysDir(), record.file), { force: true })
    rmSync(join(keysDir(), `${record.file}.pub`), { force: true })
  }
  store.set('keys', allKeys().filter((k) => k.id !== id))
  return null
}

export function listPasswords(): PasswordMeta[] {
  return allPasswords().map(({ blob: _blob, ...meta }) => meta)
}

/** 密码经 safeStorage 加密后落盘（密文 base64，系统工具读文件为乱码） */
export function addPassword(label: string, password: string): PasswordMeta {
  const record: PasswordRecord = {
    id: randomUUID(),
    label,
    blob: safeStorage.encryptString(password).toString('base64'),
    createdAt: Date.now()
  }
  store.set('passwords', [...allPasswords(), record])
  const { blob: _blob, ...meta } = record
  return meta
}

/** 修改密码备注和可选的新密码；空密码不会覆盖已有密文。 */
export function updatePassword(id: string, label: string, password: string): string | null {
  const nextLabel = label.trim()
  if (!nextLabel) return '密码备注不能为空'
  const passwords = allPasswords()
  const index = passwords.findIndex((entry) => entry.id === id)
  if (index < 0) return '密码不存在'
  passwords[index] = {
    ...passwords[index],
    label: nextLabel,
    ...(password ? { blob: safeStorage.encryptString(password).toString('base64') } : {})
  }
  store.set('passwords', passwords)
  return null
}

/** 删除密码；被主机引用时拒绝并返回引用主机名 */
export function deletePassword(id: string): string | null {
  const referenced = listHosts()
    .filter((h) => h.auth.type === 'password' && h.auth.passwordId === id)
    .map((h) => h.label || `${h.username}@${h.host}`)
  if (referenced.length > 0) return `密码正被主机引用：${referenced.join('、')}`
  store.set('passwords', allPasswords().filter((p) => p.id !== id))
  return null
}

/** 连接时取回明文（仅主进程内部使用） */
export function resolvePassword(id: string): string | null {
  const record = allPasswords().find((p) => p.id === id)
  if (!record) return null
  try {
    return safeStorage.decryptString(Buffer.from(record.blob, 'base64'))
  } catch {
    return null
  }
}

/** 连接时取密钥私钥路径（仅主进程内部使用） */
export function resolveKeyPath(id: string): string | null {
  const record = allKeys().find((k) => k.id === id)
  return record ? join(keysDir(), record.file) : null
}

/** 连接时取密钥口令（仅主进程内部使用）。 */
export function resolveKeyPassphrase(id: string): string | null {
  const record = allKeys().find((key) => key.id === id)
  if (!record?.passphraseBlob) return null
  try {
    return safeStorage.decryptString(Buffer.from(record.passphraseBlob, 'base64'))
  } catch {
    return null
  }
}

export function exportPasswordCredential(id: string): CompletePasswordCredential | null {
  const record = allPasswords().find((entry) => entry.id === id)
  if (!record) return null
  const password = resolvePassword(id)
  if (password === null) return null
  return { id: record.id, label: record.label, password, createdAt: record.createdAt }
}

export function exportKeyCredential(
  id: string,
  passphraseOverride?: string
): CompleteKeyCredential | null {
  const record = allKeys().find((entry) => entry.id === id)
  if (!record) return null
  try {
    return {
      id: record.id,
      name: record.name,
      privateKey: readFileSync(join(keysDir(), record.file), 'utf8'),
      ...(passphraseOverride || resolveKeyPassphrase(id)
        ? { passphrase: passphraseOverride || resolveKeyPassphrase(id) || undefined }
        : {}),
      createdAt: record.createdAt
    }
  } catch {
    return null
  }
}

export interface CredentialImportResult {
  passwordIdMap: Map<string, string>
  keyIdMap: Map<string, string>
  createdPasswordIds: string[]
  createdKeyIds: string[]
}

interface PreparedKey {
  record: KeyRecord
  candidatePrivate: string
  candidatePublic: string
  finalPrivate: string
  finalPublic: string
}

/**
 * 完整验证所有凭证后再提交。冲突条目只新增并返回 ID 映射，不覆盖本地凭证。
 * 私钥候选文件在提交前不会成为密钥库正式文件。
 */
export async function importCompleteCredentials(
  passwords: CompletePasswordCredential[],
  keys: CompleteKeyCredential[]
): Promise<CredentialImportResult> {
  const existingPasswords = allPasswords()
  const existingKeys = allKeys()
  const nextPasswords = [...existingPasswords]
  const nextKeys = [...existingKeys]
  const passwordIdMap = new Map<string, string>()
  const keyIdMap = new Map<string, string>()
  const createdPasswordIds: string[] = []
  const createdKeyIds: string[] = []
  const preparedKeys: PreparedKey[] = []
  const installedFiles: string[] = []

  try {
    for (const incoming of passwords) {
      const conflict = existingPasswords.find((entry) => entry.id === incoming.id)
      if (conflict && resolvePassword(conflict.id) === incoming.password) {
        passwordIdMap.set(incoming.id, conflict.id)
        continue
      }
      const id = conflict ? randomUUID() : incoming.id
      nextPasswords.push({
        id,
        label: incoming.label,
        blob: safeStorage.encryptString(incoming.password).toString('base64'),
        createdAt: incoming.createdAt || Date.now()
      })
      passwordIdMap.set(incoming.id, id)
      createdPasswordIds.push(id)
    }

    for (const incoming of keys) {
      const token = randomUUID()
      const candidatePrivate = join(keysDir(), `.import-${token}`)
      const candidatePublic = `${candidatePrivate}.pub`
      writeFileSync(candidatePrivate, incoming.privateKey, { mode: 0o600 })
      await restrictPrivateKeyPermissions(candidatePrivate)
      const { stdout: publicKey } = await execFileAsync('ssh-keygen', [
        '-y',
        '-P',
        incoming.passphrase ?? '',
        '-f',
        candidatePrivate
      ])
      writeFileSync(candidatePublic, `${publicKey.trim()}\n`, { mode: 0o600 })
      const fingerprint = await fingerprintOf(candidatePublic)
      const conflict = existingKeys.find((entry) => entry.id === incoming.id)
      if (conflict && conflict.fingerprint === fingerprint) {
        removeFileQuietly(candidatePrivate)
        removeFileQuietly(candidatePublic)
        keyIdMap.set(incoming.id, conflict.id)
        continue
      }

      const id = conflict ? randomUUID() : incoming.id
      const file = randomUUID()
      const finalPrivate = join(keysDir(), file)
      const finalPublic = `${finalPrivate}.pub`
      const record: KeyRecord = {
        id,
        name: incoming.name,
        fingerprint,
        publicKey: publicKey.trim(),
        hasPassphrase: !!incoming.passphrase,
        ...(incoming.passphrase
          ? { passphraseBlob: safeStorage.encryptString(incoming.passphrase).toString('base64') }
          : {}),
        file,
        createdAt: incoming.createdAt || Date.now()
      }
      preparedKeys.push({ record, candidatePrivate, candidatePublic, finalPrivate, finalPublic })
      nextKeys.push(record)
      keyIdMap.set(incoming.id, id)
      createdKeyIds.push(id)
    }

    for (const prepared of preparedKeys) {
      renameSync(prepared.candidatePrivate, prepared.finalPrivate)
      installedFiles.push(prepared.finalPrivate)
      renameSync(prepared.candidatePublic, prepared.finalPublic)
      installedFiles.push(prepared.finalPublic)
    }
    store.set('keys', nextKeys)
    store.set('passwords', nextPasswords)
    return { passwordIdMap, keyIdMap, createdPasswordIds, createdKeyIds }
  } catch (error) {
    for (const prepared of preparedKeys) {
      removeFileQuietly(prepared.candidatePrivate)
      removeFileQuietly(prepared.candidatePublic)
    }
    for (const path of installedFiles) removeFileQuietly(path)
    store.set('keys', existingKeys)
    store.set('passwords', existingPasswords)
    throw error
  }
}

/** 主机写入失败时撤销本次新建的凭证；现有凭证从未被覆盖。 */
export function rollbackImportedCredentials(result: CredentialImportResult): void {
  const keyIds = new Set(result.createdKeyIds)
  for (const record of allKeys()) {
    if (!keyIds.has(record.id)) continue
    removeFileQuietly(join(keysDir(), record.file))
    removeFileQuietly(join(keysDir(), `${record.file}.pub`))
  }
  store.set('keys', allKeys().filter((entry) => !keyIds.has(entry.id)))
  const passwordIds = new Set(result.createdPasswordIds)
  store.set('passwords', allPasswords().filter((entry) => !passwordIds.has(entry.id)))
}

/**
 * 仅供云同步：按记录整体覆盖写入密码（后写胜出）。
 * 明文只在主进程内存中短暂存在，落盘前经 safeStorage 加密。
 */
export function upsertPasswordForSync(entry: CompletePasswordCredential): void {
  const passwords = allPasswords()
  const index = passwords.findIndex((existing) => existing.id === entry.id)
  const record: PasswordRecord = {
    id: entry.id,
    label: entry.label,
    blob: safeStorage.encryptString(entry.password).toString('base64'),
    createdAt: entry.createdAt || Date.now()
  }
  if (index === -1) passwords.push(record)
  else passwords[index] = record
  store.set('passwords', passwords)
}

/**
 * 仅供云同步：按记录整体覆盖写入密钥（后写胜出）。
 * 私钥先写候选文件并完成公钥 / 指纹校验，通过后才原子替换正式文件；
 * 校验失败时保留原私钥与元数据。
 */
export async function upsertKeyForSync(entry: CompleteKeyCredential): Promise<void> {
  const keys = allKeys()
  const index = keys.findIndex((existing) => existing.id === entry.id)
  const existing = index >= 0 ? keys[index] : null
  const file = existing?.file ?? randomUUID()
  const finalPrivate = join(keysDir(), file)
  const finalPublic = `${finalPrivate}.pub`
  const token = randomUUID()
  const candidatePrivate = join(keysDir(), `.sync-${token}`)
  const candidatePublic = `${candidatePrivate}.pub`

  writeFileSync(candidatePrivate, entry.privateKey, { mode: 0o600 })
  try {
    await restrictPrivateKeyPermissions(candidatePrivate)
    const { stdout: publicKey } = await execFileAsync('ssh-keygen', [
      '-y',
      '-P',
      entry.passphrase ?? '',
      '-f',
      candidatePrivate
    ])
    writeFileSync(candidatePublic, `${publicKey.trim()}\n`, { mode: 0o600 })
    const fingerprint = await fingerprintOf(candidatePublic)

    renameSync(candidatePrivate, finalPrivate)
    renameSync(candidatePublic, finalPublic)
    const record: KeyRecord = {
      id: entry.id,
      name: entry.name,
      fingerprint,
      publicKey: publicKey.trim(),
      hasPassphrase: !!entry.passphrase,
      ...(entry.passphrase
        ? { passphraseBlob: safeStorage.encryptString(entry.passphrase).toString('base64') }
        : {}),
      file,
      createdAt: entry.createdAt || Date.now()
    }
    if (index === -1) keys.push(record)
    else keys[index] = record
    store.set('keys', keys)
  } catch (error) {
    removeFileQuietly(candidatePrivate)
    removeFileQuietly(candidatePublic)
    throw error
  }
}

/** 仅供云同步：删除远端已删除的密码记录（不做引用检查，调用方保证顺序）。 */
export function deletePasswordForSync(id: string): void {
  store.set('passwords', allPasswords().filter((entry) => entry.id !== id))
}

/** 仅供云同步：删除远端已删除的密钥记录并清理私钥文件。 */
export function deleteKeyForSync(id: string): void {
  const record = allKeys().find((entry) => entry.id === id)
  if (record) {
    removeFileQuietly(join(keysDir(), record.file))
    removeFileQuietly(join(keysDir(), `${record.file}.pub`))
  }
  store.set('keys', allKeys().filter((entry) => entry.id !== id))
}
