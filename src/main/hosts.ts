import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { HostConfig, HostInput, KeyEntry, PasswordMeta } from '@shared/types'

interface CredentialReference {
  type: 'key' | 'password'
  id: string
  label: string
}

export interface HostBackupDocument {
  format: 'apex-host-backup'
  version: 1
  exportedAt: string
  security: {
    secretsIncluded: false
    omittedSecrets: number
  }
  credentialReferences: CredentialReference[]
  hosts: HostConfig[]
}

/**
 * 主机配置持久化：electron-store 落盘到 userData/apex-config.json。
 * M1 密码为明文存储，safeStorage 加密属 M4（届时在此层加解密即可）。
 */
const store = new Store<{ hosts: HostConfig[] }>({
  // conf 无法从 CJS 主进程推断包名，需显式指定；electron-store v11 类型定义未暴露该字段，运行时有效
  // @ts-expect-error projectName 在 conf v15 运行时有效
  projectName: 'apex-ssh',
  name: 'apex-config',
  defaults: { hosts: [] }
})

export function listHosts(): HostConfig[] {
  return store.get('hosts')
}

export function addHost(input: HostInput): HostConfig {
  const host: HostConfig = { ...input, id: randomUUID() }
  store.set('hosts', [...listHosts(), host])
  return host
}

export function deleteHost(id: string): void {
  store.set(
    'hosts',
    listHosts().filter((h) => h.id !== id)
  )
}

export function updateHost(id: string, input: HostInput): HostConfig {
  const hosts = listHosts()
  const idx = hosts.findIndex((h) => h.id === id)
  if (idx === -1) throw new Error('主机不存在')
  const updated: HostConfig = { ...input, id }
  hosts[idx] = updated
  store.set('hosts', hosts)
  return updated
}

/** 生成不含敏感凭证本体的可移植备份文档。 */
export function createHostBackup(
  keys: KeyEntry[],
  passwords: PasswordMeta[]
): HostBackupDocument {
  let omittedSecrets = 0
  const keyMap = new Map(keys.map((entry) => [entry.id, entry.name]))
  const passwordMap = new Map(passwords.map((entry) => [entry.id, entry.label]))
  const references = new Map<string, CredentialReference>()

  const hosts = listHosts().map((host): HostConfig => {
    if (host.auth.type === 'password') {
      if (host.auth.password) omittedSecrets++
      if (host.auth.passwordId) {
        references.set(`password:${host.auth.passwordId}`, {
          type: 'password',
          id: host.auth.passwordId,
          label: passwordMap.get(host.auth.passwordId) ?? ''
        })
      }
      return {
        ...host,
        auth: host.auth.passwordId
          ? { type: 'password', passwordId: host.auth.passwordId }
          : { type: 'password' }
      }
    }

    if (host.auth.passphrase) omittedSecrets++
    if (host.auth.keyId) {
      references.set(`key:${host.auth.keyId}`, {
        type: 'key',
        id: host.auth.keyId,
        label: keyMap.get(host.auth.keyId) ?? ''
      })
    }
    return {
      ...host,
      auth: host.auth.keyId
        ? { type: 'key', keyId: host.auth.keyId }
        : { type: 'key', privateKeyPath: host.auth.privateKeyPath }
    }
  })

  return {
    format: 'apex-host-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    security: { secretsIncluded: false, omittedSecrets },
    credentialReferences: [...references.values()],
    hosts
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`主机字段 ${field} 无效`)
  return value
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`主机字段 ${field} 无效`)
  return value
}

/** 严格解析备份，并再次剔除可能由外部文件注入的敏感字段。 */
export function parseHostBackup(value: unknown): HostBackupDocument {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式无效')
  const document = value as Partial<HostBackupDocument>
  if (document.format !== 'apex-host-backup' || document.version !== 1) {
    throw new Error('不支持的主机备份格式或版本')
  }
  if (!Array.isArray(document.hosts)) throw new Error('备份文件缺少主机列表')

  const ids = new Set<string>()
  let omittedSecrets = 0
  const hosts = document.hosts.map((raw, index): HostConfig => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 条主机配置无效`)
    const host = raw as HostConfig
    const id = requiredString(host.id, 'id')
    if (ids.has(id)) throw new Error(`备份中存在重复主机 id：${id}`)
    ids.add(id)
    if (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535) {
      throw new Error(`第 ${index + 1} 条主机端口无效`)
    }
    const base = {
      id,
      label: stringValue(host.label, 'label'),
      ...(typeof host.description === 'string' && host.description.trim()
        ? { description: host.description }
        : {}),
      host: requiredString(host.host, 'host'),
      port: host.port,
      username: requiredString(host.username, 'username'),
      ...(typeof host.group === 'string' && host.group.trim() ? { group: host.group } : {})
    }
    if (!host.auth || (host.auth.type !== 'password' && host.auth.type !== 'key')) {
      throw new Error(`第 ${index + 1} 条主机认证配置无效`)
    }
    if (host.auth.type === 'password') {
      if (host.auth.password) omittedSecrets++
      return {
        ...base,
        auth:
          typeof host.auth.passwordId === 'string' && host.auth.passwordId
            ? { type: 'password', passwordId: host.auth.passwordId }
            : { type: 'password' }
      }
    }
    if (host.auth.passphrase) omittedSecrets++
    return {
      ...base,
      auth:
        typeof host.auth.keyId === 'string' && host.auth.keyId
          ? { type: 'key', keyId: host.auth.keyId }
          : {
              type: 'key',
              ...(typeof host.auth.privateKeyPath === 'string' && host.auth.privateKeyPath
                ? { privateKeyPath: host.auth.privateKeyPath }
                : {})
            }
    }
  })

  return {
    format: 'apex-host-backup',
    version: 1,
    exportedAt:
      typeof document.exportedAt === 'string' ? document.exportedAt : new Date(0).toISOString(),
    security: {
      secretsIncluded: false,
      omittedSecrets:
        (typeof document.security?.omittedSecrets === 'number' &&
        Number.isFinite(document.security.omittedSecrets)
          ? Math.max(0, document.security.omittedSecrets)
          : 0) + omittedSecrets
    },
    credentialReferences: Array.isArray(document.credentialReferences)
      ? document.credentialReferences.filter(
          (entry): entry is CredentialReference =>
            !!entry &&
            (entry.type === 'key' || entry.type === 'password') &&
            typeof entry.id === 'string' &&
            typeof entry.label === 'string'
        )
      : [],
    hosts
  }
}

export function importHosts(
  incoming: HostConfig[],
  mode: 'merge' | 'replace'
): { added: number; updated: number } {
  const current = listHosts()
  if (mode === 'replace') {
    store.set('hosts', incoming)
    return { added: incoming.length, updated: 0 }
  }
  const merged = [...current]
  let added = 0
  let updated = 0
  for (const host of incoming) {
    const index = merged.findIndex((entry) => entry.id === host.id)
    if (index === -1) {
      merged.push(host)
      added++
    } else {
      merged[index] = host
      updated++
    }
  }
  store.set('hosts', merged)
  return { added, updated }
}

/** 仅用于完整备份事务失败后的主机快照恢复。 */
export function restoreHostsSnapshot(hosts: HostConfig[]): void {
  store.set('hosts', hosts)
}

/** 仅供云同步：按记录整体覆盖写入（后写胜出），调用方已完成形状校验。 */
export function upsertHostForSync(host: HostConfig): void {
  const hosts = listHosts()
  const index = hosts.findIndex((entry) => entry.id === host.id)
  if (index === -1) hosts.push(host)
  else hosts[index] = host
  store.set('hosts', hosts)
}

/** 仅供云同步：删除远端已删除的主机记录。 */
export function deleteHostForSync(id: string): void {
  store.set(
    'hosts',
    listHosts().filter((entry) => entry.id !== id)
  )
}
