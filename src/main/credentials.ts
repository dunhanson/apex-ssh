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
  return allKeys().map(({ file: _file, ...meta }) => meta)
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
    const { file: _file, ...entry } = record
    return { entry }
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
    const { file: _file, ...entry } = record
    return { entry }
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
      publicKey: pub.trim()
    }
    keys[index] = nextRecord
    store.set('keys', keys)
    removeFileQuietly(backupPriv)
    removeFileQuietly(backupPub)
    const { file: _file, ...entry } = nextRecord
    return { entry }
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
