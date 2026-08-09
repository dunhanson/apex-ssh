import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { EncryptedBackupStats, HostConfig } from '@shared/types'
import {
  type CompleteBackupPayload,
  type CompleteKeyCredential,
  type CompletePasswordCredential
} from './encrypted-backup'
import {
  exportKeyCredential,
  exportPasswordCredential,
  importCompleteCredentials,
  listKeys,
  rollbackImportedCredentials
} from './credentials'
import {
  importGroups,
  importHosts,
  listGroups,
  listHosts,
  restoreGroupsSnapshot,
  restoreHostsSnapshot
} from './hosts'

function hostName(host: HostConfig): string {
  return host.label.trim() || `${host.username}@${host.host}`
}

/** 仅根据主机引用和凭证元数据统计条目，不读取密码、私钥或口令明文。 */
export function getCompleteBackupStats(): EncryptedBackupStats {
  const hosts = listHosts()
  const keyMetadata = new Map(listKeys().map((entry) => [entry.id, entry]))
  const passwordIds = new Set<string>()
  const keyIds = new Set<string>()
  let directPasswords = 0
  let directKeys = 0
  let directPassphrases = 0
  const passphraseKeyIds = new Set<string>()

  for (const host of hosts) {
    if (host.auth.type === 'password') {
      if (host.auth.passwordId) passwordIds.add(host.auth.passwordId)
      else if (host.auth.password !== undefined) directPasswords++
      continue
    }
    if (host.auth.keyId) {
      keyIds.add(host.auth.keyId)
      if (host.auth.passphrase || keyMetadata.get(host.auth.keyId)?.hasPassphrase) {
        passphraseKeyIds.add(host.auth.keyId)
      }
    } else if (host.auth.privateKeyPath) {
      directKeys++
      if (host.auth.passphrase) directPassphrases++
    }
  }
  return {
    hosts: hosts.length,
    passwords: passwordIds.size + directPasswords,
    keys: keyIds.size + directKeys,
    passphrases: passphraseKeyIds.size + directPassphrases
  }
}

/** 收集恢复连接所必需的受控凭证，并将所有直填认证迁移为载荷内凭证引用。 */
export function createCompleteBackupPayload(): CompleteBackupPayload {
  const passwords = new Map<string, CompletePasswordCredential>()
  const keys = new Map<string, CompleteKeyCredential>()
  const hosts = listHosts().map((host): HostConfig => {
    if (host.auth.type === 'password') {
      if (host.auth.passwordId) {
        const credential = exportPasswordCredential(host.auth.passwordId)
        if (!credential) throw new Error(`主机「${hostName(host)}」引用的密码不可用`)
        passwords.set(credential.id, credential)
        return { ...host, auth: { type: 'password', passwordId: credential.id } }
      }
      if (host.auth.password !== undefined) {
        const id = randomUUID()
        passwords.set(id, {
          id,
          label: hostName(host),
          password: host.auth.password,
          createdAt: Date.now()
        })
        return { ...host, auth: { type: 'password', passwordId: id } }
      }
      return { ...host, auth: { type: 'password' } }
    }

    if (host.auth.keyId) {
      const credential = exportKeyCredential(host.auth.keyId, host.auth.passphrase)
      if (!credential) throw new Error(`主机「${hostName(host)}」引用的私钥不可用`)
      const existing = keys.get(credential.id)
      if (existing?.passphrase && credential.passphrase && existing.passphrase !== credential.passphrase) {
        throw new Error(`私钥「${credential.name}」存在不一致的口令配置`)
      }
      keys.set(credential.id, existing?.passphrase ? existing : credential)
      return { ...host, auth: { type: 'key', keyId: credential.id } }
    }
    if (host.auth.privateKeyPath) {
      const id = randomUUID()
      let privateKey: string
      try {
        privateKey = readFileSync(host.auth.privateKeyPath, 'utf8')
      } catch {
        throw new Error(`主机「${hostName(host)}」引用的私钥文件无法读取`)
      }
      keys.set(id, {
        id,
        name: hostName(host),
        privateKey,
        ...(host.auth.passphrase ? { passphrase: host.auth.passphrase } : {}),
        createdAt: Date.now()
      })
      return { ...host, auth: { type: 'key', keyId: id } }
    }
    return { ...host, auth: { type: 'key' } }
  })

  const passwordEntries = [...passwords.values()]
  const keyEntries = [...keys.values()]
  return {
    format: 'apex-complete-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    stats: {
      hosts: hosts.length,
      passwords: passwordEntries.length,
      keys: keyEntries.length,
      passphrases: keyEntries.filter((entry) => !!entry.passphrase).length
    },
    groups: listGroups(),
    hosts,
    passwords: passwordEntries,
    keys: keyEntries
  }
}

export async function importCompleteBackupPayload(
  payload: CompleteBackupPayload,
  mode: 'merge' | 'replace'
): Promise<{ added: number; updated: number }> {
  const hostSnapshot = listHosts()
  const groupSnapshot = listGroups()
  const imported = await importCompleteCredentials(payload.passwords, payload.keys)
  try {
    const hosts = payload.hosts.map((host): HostConfig => {
      if (host.auth.type === 'password' && host.auth.passwordId) {
        const passwordId = imported.passwordIdMap.get(host.auth.passwordId)
        if (!passwordId) throw new Error('密码引用重映射失败')
        return { ...host, auth: { type: 'password', passwordId } }
      }
      if (host.auth.type === 'key' && host.auth.keyId) {
        const keyId = imported.keyIdMap.get(host.auth.keyId)
        if (!keyId) throw new Error('私钥引用重映射失败')
        return { ...host, auth: { type: 'key', keyId } }
      }
      return host
    })
    const result = importHosts(hosts, mode)
    importGroups(
      payload.groups ?? [...new Set(hosts.map((host) => host.group).filter((name): name is string => !!name))]
        .map((name, order) => ({ name, order })),
      mode
    )
    return result
  } catch (error) {
    try {
      restoreHostsSnapshot(hostSnapshot)
      restoreGroupsSnapshot(groupSnapshot)
    } finally {
      rollbackImportedCredentials(imported)
    }
    throw error
  }
}
