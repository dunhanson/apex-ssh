import Store from 'electron-store'
import { BrowserWindow, clipboard, ipcMain, safeStorage } from 'electron'
import { createHmac } from 'node:crypto'
import type {
  CloudSyncConnectionInput,
  CloudSyncConnectionView,
  CloudSyncErrorCode,
  CloudSyncGenerateKeyResult,
  CloudSyncResult,
  CloudSyncState,
  HostConfig
} from '@shared/types'
import { IPC } from '@shared/types'
import type {
  CompleteKeyCredential,
  CompletePasswordCredential
} from './encrypted-backup'
import {
  SYNC_KEY_ERROR,
  SYNC_RECORD_VERSION,
  decryptSyncRecord,
  encryptSyncRecord,
  generateSyncKey,
  type SyncRecordEnvelope,
  type SyncRecordKind
} from './sync-record-crypto'
import {
  markDeleted,
  markPulled,
  markPushed,
  planMerge,
  type LocalSyncEntry,
  type RemoteSyncEntry,
  type ShadowState
} from './cloud-sync-merge'
import {
  deleteKeyForSync,
  deletePasswordForSync,
  exportKeyCredential,
  exportPasswordCredential,
  upsertKeyForSync,
  upsertPasswordForSync
} from './credentials'
import { deleteHostForSync, listHosts, upsertHostForSync } from './hosts'

/**
 * 云同步服务（PostgreSQL 直连，推荐用户自建 Supabase 免费项目）。
 *
 * - 平台不持有任何数据：数据库连接参数由用户填写，云端只存端到端加密后的密文。
 * - 同步密钥（24 位随机）与数据库密码经 safeStorage 加密持久化，明文只在主进程
 *   内存中短暂存在，IPC 永不返回密钥、数据库密码或解密载荷。
 * - 冲突按记录“后写胜出”；合并决策在 cloud-sync-merge.ts（纯函数），
 *   记录加解密在 sync-record-crypto.ts，本文件只做连接、IO、状态广播与 IPC。
 * - pg 懒加载，未配置云同步时不产生任何网络请求。
 */

const SYNC_FORMAT_VERSION = String(SYNC_RECORD_VERSION)
const CONNECT_TIMEOUT_MS = 10_000
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000
const LOCAL_CHANGE_DEBOUNCE_MS = 5 * 1000
const STARTUP_SYNC_DELAY_MS = 5 * 1000

interface StoredConnection {
  host: string
  port: number
  database: string
  user: string
  /** safeStorage 密文 base64 */
  passwordBlob: string
}

interface CloudSyncPersistent {
  connection?: StoredConnection
  /** 同步密钥的 safeStorage 密文 base64 */
  syncKeyBlob?: string
  enabled: boolean
  shadow: ShadowState
  lastSyncAt?: number
  lastResult?: CloudSyncResult
}

const store = new Store<CloudSyncPersistent>({
  // conf 无法从 CJS 主进程推断包名，需显式指定；electron-store v11 类型定义未暴露该字段，运行时有效
  // @ts-expect-error projectName 在 conf v15 运行时有效
  projectName: 'apex-ssh',
  name: 'apex-cloud-sync',
  defaults: { enabled: false, shadow: {} }
})

type PgClient = import('pg').Client

/** 懒加载 pg，避免未启用云同步的用户承担加载成本 */
function loadPg(): typeof import('pg') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('pg') as typeof import('pg')
}

let syncing = false
let lastError: { code: CloudSyncErrorCode; message: string } | undefined
let debounceTimer: NodeJS.Timeout | null = null
let pendingGeneratedSyncKey: string | null = null

function persisted(): CloudSyncPersistent {
  return {
    enabled: store.get('enabled', false),
    shadow: store.get('shadow', {}),
    connection: store.get('connection'),
    syncKeyBlob: store.get('syncKeyBlob'),
    lastSyncAt: store.get('lastSyncAt'),
    lastResult: store.get('lastResult')
  }
}

function decryptBlob(blob: string | undefined): string | null {
  if (!blob) return null
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'))
  } catch {
    return null
  }
}

function resolveSyncKey(): string | null {
  return decryptBlob(persisted().syncKeyBlob)
}

function currentState(): CloudSyncState {
  const state = persisted()
  return {
    configured: !!state.connection,
    enabled: state.enabled,
    hasKey: !!state.syncKeyBlob,
    syncing,
    ...(state.lastSyncAt ? { lastSyncAt: state.lastSyncAt } : {}),
    ...(state.lastResult ? { lastResult: state.lastResult } : {}),
    ...(lastError ? { errorCode: lastError.code, message: lastError.message } : {})
  }
}

function broadcastState(): void {
  const snapshot = currentState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.CloudSyncStateChanged, snapshot)
  }
}

/** 拉取应用了本地变更后广播，渲染端重新加载主机与凭证列表 */
function broadcastApplied(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.CloudSyncApplied)
  }
}

function normalizeConnectionInput(
  input: CloudSyncConnectionInput
): { host: string; port: number; database: string; user: string } | string {
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const database = typeof input.database === 'string' ? input.database.trim() : ''
  const user = typeof input.user === 'string' ? input.user.trim() : ''
  const port = input.port
  if (!host || host.length > 255) return '数据库主机无效'
  if (!database || database.length > 128) return '数据库名无效'
  if (!user || user.length > 128) return '数据库用户名无效'
  if (!Number.isInteger(port) || port < 1 || port > 65535) return '数据库端口无效'
  return { host, port, database, user }
}

async function connectWith(
  connection: { host: string; port: number; database: string; user: string },
  password: string
): Promise<PgClient> {
  const { Client } = loadPg()
  const client = new Client({
    ...connection,
    password,
    // 与 Supabase Shared Pooler 的默认直连方式保持一致，不启用 PostgreSQL TLS。
    ssl: false,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: 30_000
  })
  await client.connect()
  return client
}

/** 初始化表结构并校验格式版本；更高版本拒绝同步并提示升级 */
async function ensureSchema(client: PgClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS apex_sync_records (
      record_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      envelope JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE
    )
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS apex_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  await client.query(
    'INSERT INTO apex_sync_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    ['format_version', SYNC_FORMAT_VERSION]
  )
  const result = await client.query("SELECT value FROM apex_sync_meta WHERE key = 'format_version'")
  const version = result.rows[0]?.value
  if (version !== SYNC_FORMAT_VERSION) {
    throw new CloudSyncError('format', '云端同步数据由更新版本的应用写入，请升级后再同步')
  }
}

class CloudSyncError extends Error {
  constructor(
    readonly code: CloudSyncErrorCode,
    message: string
  ) {
    super(message)
  }
}

function classifyError(error: unknown): CloudSyncError {
  if (error instanceof CloudSyncError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (message === SYNC_KEY_ERROR) return new CloudSyncError('key', SYNC_KEY_ERROR)
  return new CloudSyncError('connection', message)
}

function hostName(host: HostConfig): string {
  return host.label.trim() || `${host.username}@${host.host}`
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, sortValue(source[key])])
    )
  }
  return value
}

/** 使用同步密钥生成规范化业务数据的 HMAC，作为本地变更检测的依据。 */
function hashRecordData(data: unknown, syncKey: string): string {
  return createHmac('sha256', syncKey).update(JSON.stringify(sortValue(data))).digest('hex')
}

interface CollectedRecord {
  recordId: string
  kind: SyncRecordKind
  hash: string
  data: unknown
}

/**
 * 收集本地记录：主机 + 被引用的密码 / 密钥凭证。
 * 直填密码与本地路径私钥按确定性 ID（direct-<hostId>）迁移为载荷内凭证引用，
 * 与加密完整备份语义一致；createdAt 固定为 0 保证散列稳定。
 */
function collectLocalRecords(syncKey: string): Map<string, CollectedRecord> {
  const records = new Map<string, CollectedRecord>()
  const collect = (recordId: string, kind: SyncRecordKind, data: unknown): void => {
    if (records.has(recordId)) return
    records.set(recordId, { recordId, kind, hash: hashRecordData(data, syncKey), data })
  }

  for (const host of listHosts()) {
    let payloadHost: HostConfig
    if (host.auth.type === 'password') {
      if (host.auth.passwordId) {
        const credential = exportPasswordCredential(host.auth.passwordId)
        if (credential) {
          collect(`password:${credential.id}`, 'password', credential)
          payloadHost = { ...host, auth: { type: 'password', passwordId: credential.id } }
        } else {
          payloadHost = { ...host, auth: { type: 'password' } }
        }
      } else if (host.auth.password !== undefined) {
        const directId = `direct-${host.id}`
        collect(`password:${directId}`, 'password', {
          id: directId,
          label: hostName(host),
          password: host.auth.password,
          createdAt: 0
        } satisfies CompletePasswordCredential)
        payloadHost = { ...host, auth: { type: 'password', passwordId: directId } }
      } else {
        payloadHost = { ...host, auth: { type: 'password' } }
      }
    } else {
      if (host.auth.keyId) {
        const credential = exportKeyCredential(host.auth.keyId, host.auth.passphrase)
        if (credential) {
          collect(`key:${credential.id}`, 'key', credential)
          payloadHost = { ...host, auth: { type: 'key', keyId: credential.id } }
        } else {
          payloadHost = { ...host, auth: { type: 'key' } }
        }
      } else if (host.auth.privateKeyPath) {
        let privateKey: string | null = null
        try {
          privateKey = readFileSync(host.auth.privateKeyPath, 'utf8')
        } catch {
          privateKey = null
        }
        if (privateKey !== null) {
          const directId = `direct-${host.id}`
          collect(`key:${directId}`, 'key', {
            id: directId,
            name: hostName(host),
            privateKey,
            ...(host.auth.passphrase ? { passphrase: host.auth.passphrase } : {}),
            createdAt: 0
          } satisfies CompleteKeyCredential)
          payloadHost = { ...host, auth: { type: 'key', keyId: directId } }
        } else {
          payloadHost = { ...host, auth: { type: 'key' } }
        }
      } else {
        payloadHost = { ...host, auth: { type: 'key' } }
      }
    }
    collect(`host:${host.id}`, 'host', payloadHost)
  }
  return records
}

function asString(value: unknown, max = 1024 * 1024): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

/** 校验拉取的主机记录形状；无效返回 null（计入 skipped） */
function asSyncHost(value: unknown): HostConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = asString(raw.id, 128)
  const label = asString(raw.label, 1024)
  const host = asString(raw.host, 1024)
  const username = asString(raw.username, 1024)
  if (!id || label === null || !host || !username) return null
  if (!Number.isInteger(raw.port) || (raw.port as number) < 1 || (raw.port as number) > 65535) {
    return null
  }
  const auth = raw.auth
  if (!auth || typeof auth !== 'object') return null
  const authRaw = auth as Record<string, unknown>
  const base = {
    id,
    label,
    ...(typeof raw.description === 'string' && raw.description
      ? { description: asString(raw.description, 4096) ?? '' }
      : {}),
    host,
    port: raw.port as number,
    username,
    ...(typeof raw.group === 'string' && raw.group ? { group: raw.group.slice(0, 1024) } : {})
  }
  if (authRaw.type === 'password') {
    return {
      ...base,
      auth: {
        type: 'password',
        ...(typeof authRaw.passwordId === 'string' && authRaw.passwordId
          ? { passwordId: authRaw.passwordId.slice(0, 128) }
          : {})
      }
    }
  }
  if (authRaw.type === 'key') {
    return {
      ...base,
      auth: {
        type: 'key',
        ...(typeof authRaw.keyId === 'string' && authRaw.keyId
          ? { keyId: authRaw.keyId.slice(0, 128) }
          : {})
      }
    }
  }
  return null
}

function asSyncPassword(value: unknown): CompletePasswordCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = asString(raw.id, 128)
  const label = asString(raw.label, 1024)
  const password = asString(raw.password)
  if (!id || label === null || password === null) return null
  return {
    id,
    label,
    password,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0
  }
}

function asSyncKey(value: unknown): CompleteKeyCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = asString(raw.id, 128)
  const name = asString(raw.name, 1024)
  const privateKey = asString(raw.privateKey, 4 * 1024 * 1024)
  if (!id || !name || !privateKey) return null
  return {
    id,
    name,
    privateKey,
    ...(typeof raw.passphrase === 'string' && raw.passphrase
      ? { passphrase: raw.passphrase }
      : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0
  }
}

interface RemoteRow {
  recordId: string
  kind: SyncRecordKind
  updatedAt: number
  deleted: boolean
  envelope: unknown
}

const VALID_KINDS = new Set<SyncRecordKind>(['host', 'password', 'key'])

async function fetchRemoteRows(client: PgClient): Promise<Map<string, RemoteRow>> {
  const result = await client.query(
    'SELECT record_id, kind, envelope, updated_at, deleted FROM apex_sync_records'
  )
  const rows = new Map<string, RemoteRow>()
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const recordId = asString(row.record_id, 256)
    const kind = asString(row.kind, 32) as SyncRecordKind | null
    const updatedAt = new Date(row.updated_at as string).getTime()
    if (!recordId || !kind || !VALID_KINDS.has(kind) || !Number.isFinite(updatedAt)) continue
    rows.set(recordId, {
      recordId,
      kind,
      updatedAt,
      deleted: row.deleted === true,
      envelope: row.envelope
    })
  }
  return rows
}

async function upsertRemoteRecord(
  client: PgClient,
  recordId: string,
  kind: SyncRecordKind,
  envelope: SyncRecordEnvelope,
  updatedAt: number,
  deleted: boolean
): Promise<void> {
  // 服务端后写胜出护栏：远端已有更新记录时本次写入被忽略
  await client.query(
    `INSERT INTO apex_sync_records (record_id, kind, envelope, updated_at, deleted)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (record_id) DO UPDATE
       SET envelope = EXCLUDED.envelope, updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted
       WHERE apex_sync_records.updated_at < EXCLUDED.updated_at`,
    [recordId, kind, JSON.stringify(envelope), new Date(updatedAt), deleted]
  )
}

async function deleteAllRemoteRecords(client: PgClient): Promise<void> {
  await client.query('DELETE FROM apex_sync_records')
}

/** 用当前同步密钥试解密远端样本记录，校验密钥正确性 */
async function verifyKeyAgainstRemote(client: PgClient, syncKey: string): Promise<boolean> {
  const result = await client.query(
    'SELECT record_id, kind, envelope FROM apex_sync_records WHERE deleted = FALSE LIMIT 3'
  )
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const recordId = asString(row.record_id, 256)
    const kind = asString(row.kind, 32) as SyncRecordKind | null
    if (!recordId || !kind || !VALID_KINDS.has(kind)) continue
    try {
      await decryptSyncRecord(recordId, kind, row.envelope, syncKey)
    } catch {
      return false
    }
  }
  return true
}

async function openVerifiedClient(): Promise<{ client: PgClient; syncKey: string }> {
  const state = persisted()
  if (!state.connection) throw new CloudSyncError('connection', '尚未配置数据库连接')
  const password = decryptBlob(state.connection.passwordBlob)
  if (password === null) throw new CloudSyncError('connection', '数据库密码不可用，请重新保存连接参数')
  const syncKey = resolveSyncKey()
  if (!syncKey) throw new CloudSyncError('key', '尚未设置同步密钥')
  const client = await connectWith(state.connection, password)
  try {
    await ensureSchema(client)
  } catch (error) {
    await client.end().catch(() => undefined)
    throw error
  }
  return { client, syncKey }
}

/**
 * 执行一次完整同步：拉取远端 → 三方合并 → 应用拉取 → 推送变更。
 * 单条记录失败（解密、校验、写入）只计入 skipped / 错误日志，不中断其他记录。
 */
export async function syncNow(): Promise<string | null> {
  const state = persisted()
  if (!state.enabled || syncing) return null
  syncing = true
  lastError = undefined
  broadcastState()

  const shadow: ShadowState = { ...state.shadow }
  const result: CloudSyncResult = { pushed: 0, pulled: 0, deleted: 0, skipped: 0, conflicts: 0 }
  let appliedRemoteChanges = false

  try {
    const { client, syncKey } = await openVerifiedClient()
    try {
      const remoteRows = await fetchRemoteRows(client)
      const localRecords = collectLocalRecords(syncKey)
      const localEntries: LocalSyncEntry[] = [...localRecords.values()].map(
        ({ recordId, kind, hash }) => ({ recordId, kind, hash })
      )
      const remoteEntries: RemoteSyncEntry[] = [...remoteRows.values()].map(
        ({ recordId, kind, updatedAt, deleted }) => ({ recordId, kind, updatedAt, deleted })
      )
      const plan = planMerge(localEntries, remoteEntries, shadow)
      result.conflicts = plan.conflicts

      // 1. 远端删除墓碑：先删主机，再删凭证（避免主机引用悬空窗口期被使用）
      for (const action of [...plan.pullDelete].sort((a) => (a.kind === 'host' ? -1 : 1))) {
        try {
          if (action.kind === 'host') deleteHostForSync(action.recordId.slice('host:'.length))
          else if (action.kind === 'password') {
            deletePasswordForSync(action.recordId.slice('password:'.length))
          } else deleteKeyForSync(action.recordId.slice('key:'.length))
          markDeleted(shadow, action.recordId, remoteRows.get(action.recordId)?.updatedAt ?? 0)
          result.deleted += 1
          appliedRemoteChanges = true
        } catch (error) {
          console.error('[cloud-sync] 删除本地记录失败', action.recordId, error)
          result.skipped += 1
        }
      }

      // 2. 拉取应用：先凭证后主机，保证主机引用可解析
      const pullOrder = (kind: SyncRecordKind): number =>
        kind === 'password' ? 0 : kind === 'key' ? 1 : 2
      for (const action of [...plan.pull].sort((a, b) => pullOrder(a.kind) - pullOrder(b.kind))) {
        const row = remoteRows.get(action.recordId)
        if (!row) continue
        try {
          const payload = await decryptSyncRecord(action.recordId, action.kind, row.envelope, syncKey)
          if (action.kind === 'password') {
            const entry = asSyncPassword(payload.data)
            if (!entry) throw new Error('密码记录无效')
            upsertPasswordForSync(entry)
            markPulled(shadow, action.recordId, hashRecordData(entry, syncKey), row.updatedAt)
          } else if (action.kind === 'key') {
            const entry = asSyncKey(payload.data)
            if (!entry) throw new Error('密钥记录无效')
            await upsertKeyForSync(entry)
            markPulled(shadow, action.recordId, hashRecordData(entry, syncKey), row.updatedAt)
          } else {
            const host = asSyncHost(payload.data)
            if (!host) throw new Error('主机记录无效')
            upsertHostForSync(host)
            markPulled(shadow, action.recordId, hashRecordData(host, syncKey), row.updatedAt)
          }
          result.pulled += 1
          appliedRemoteChanges = true
        } catch (error) {
          // 解密失败（密钥错误 / 记录被篡改）或校验失败：跳过该记录
          console.error('[cloud-sync] 拉取记录失败', action.recordId, error)
          result.skipped += 1
        }
      }

      // 3. 推送：本地新增 / 变更的记录加密上传
      const now = Date.now()
      for (const action of plan.push) {
        const record = localRecords.get(action.recordId)
        if (!record) continue
        try {
          const envelope = await encryptSyncRecord(
            action.recordId,
            action.kind,
            { updatedAt: now, data: record.data },
            syncKey
          )
          await upsertRemoteRecord(client, action.recordId, action.kind, envelope, now, false)
          markPushed(shadow, action.recordId, record.hash, now, false)
          result.pushed += 1
        } catch (error) {
          console.error('[cloud-sync] 推送记录失败', action.recordId, error)
          result.skipped += 1
        }
      }

      // 4. 本地删除：上传墓碑
      for (const action of plan.pushTombstone) {
        try {
          const envelope = await encryptSyncRecord(
            action.recordId,
            action.kind,
            { updatedAt: now, data: null },
            syncKey
          )
          await upsertRemoteRecord(client, action.recordId, action.kind, envelope, now, true)
          markPushed(shadow, action.recordId, '', now, true)
          result.pushed += 1
        } catch (error) {
          console.error('[cloud-sync] 推送墓碑失败', action.recordId, error)
          result.skipped += 1
        }
      }

      // 5. 清理双方均已不存在的 shadow 残留
      for (const recordId of plan.prune) delete shadow[recordId]

      store.set('shadow', shadow)
      store.set('lastSyncAt', now)
      store.set('lastResult', result)
    } finally {
      await client.end().catch(() => undefined)
    }
  } catch (error) {
    const classified = classifyError(error)
    // 原始错误只进主进程日志；渲染端按 errorCode 展示友好文案
    console.error('[cloud-sync]', classified.message)
    lastError = { code: classified.code, message: classified.message }
  } finally {
    syncing = false
    broadcastState()
    if (appliedRemoteChanges) broadcastApplied()
  }
  return lastError?.message ?? null
}

/** 本地主机 / 凭证变更后防抖触发同步（仅启用时生效） */
export function notifyLocalChange(): void {
  if (!persisted().enabled) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void syncNow()
  }, LOCAL_CHANGE_DEBOUNCE_MS)
  debounceTimer.unref()
}

/** 初始化云同步：启用状态下启动时同步一次并定时拉取 */
export function initCloudSync(): void {
  if (!persisted().enabled) return
  const startup = setTimeout(() => void syncNow(), STARTUP_SYNC_DELAY_MS)
  startup.unref()
  const interval = setInterval(() => void syncNow(), AUTO_SYNC_INTERVAL_MS)
  interval.unref()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 注册云同步 IPC（白名单：状态、连接、密钥、启停、同步、清空） */
export function registerCloudSyncIpc(): void {
  ipcMain.handle(IPC.CloudSyncGetState, () => currentState())

  ipcMain.handle(IPC.CloudSyncGetConnection, (): CloudSyncConnectionView | null => {
    const connection = persisted().connection
    if (!connection) return null
    const { passwordBlob: _passwordBlob, ...view } = connection
    return view
  })

  ipcMain.handle(
    IPC.CloudSyncSaveConnection,
    (_e, input: CloudSyncConnectionInput): string | null => {
      const normalized = normalizeConnectionInput(input)
      if (typeof normalized === 'string') return normalized
      const previous = persisted().connection
      const password = typeof input.password === 'string' ? input.password : ''
      const passwordBlob = password
        ? safeStorage.encryptString(password).toString('base64')
        : previous?.passwordBlob
      if (!passwordBlob) return '请填写数据库密码'
      store.set('connection', { ...normalized, passwordBlob })
      // 连接目标变化后 shadow 不再可信，下一次同步按全新合并重新建立
      if (
        !previous ||
        previous.host !== normalized.host ||
        previous.port !== normalized.port ||
        previous.database !== normalized.database ||
        previous.user !== normalized.user
      ) {
        store.set('shadow', {})
      }
      broadcastState()
      return null
    }
  )

  ipcMain.handle(
    IPC.CloudSyncTestConnection,
    async (_e, input: CloudSyncConnectionInput): Promise<string | null> => {
      const normalized = normalizeConnectionInput(input)
      if (typeof normalized === 'string') return normalized
      const password =
        typeof input.password === 'string' && input.password
          ? input.password
          : decryptBlob(persisted().connection?.passwordBlob)
      if (password === null) return '请填写数据库密码'
      try {
        const client = await connectWith(normalized, password)
        try {
          await ensureSchema(client)
        } finally {
          await client.end().catch(() => undefined)
        }
        return null
      } catch (error) {
        console.error('[cloud-sync] 测试连接失败', error)
        return errorMessage(error)
      }
    }
  )

  ipcMain.handle(IPC.CloudSyncGenerateKey, async (): Promise<CloudSyncGenerateKeyResult> => {
    const syncKey = generateSyncKey()
    store.set('syncKeyBlob', safeStorage.encryptString(syncKey).toString('base64'))
    pendingGeneratedSyncKey = syncKey
    store.set('shadow', {})
    broadcastState()
    // 更换密钥后云端旧密文不可用：在线时直接清空并全量重写
    const state = persisted()
    if (state.enabled && state.connection) {
      try {
        const { client } = await openVerifiedClient()
        try {
          await deleteAllRemoteRecords(client)
        } finally {
          await client.end().catch(() => undefined)
        }
        return { copyAvailable: true, error: await syncNow() }
      } catch (error) {
        console.error('[cloud-sync] 重置云端数据失败', error)
        return { copyAvailable: true, error: errorMessage(error) }
      }
    }
    return { copyAvailable: true, error: null }
  })

  ipcMain.handle(IPC.CloudSyncCopyGeneratedKey, (): boolean => {
    if (!pendingGeneratedSyncKey) return false
    try {
      clipboard.writeText(pendingGeneratedSyncKey)
      pendingGeneratedSyncKey = null
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.CloudSyncSetKey, async (_e, key: string): Promise<string | null> => {
    if (typeof key !== 'string' || key.trim().length < 12) return '同步密钥无效'
    const syncKey = key.trim()
    pendingGeneratedSyncKey = null
    const state = persisted()
    // 云端已有数据时先校验密钥可解密，避免错误密钥污染云端
    if (state.connection) {
      const password = decryptBlob(state.connection.passwordBlob)
      if (password !== null) {
        try {
          const client = await connectWith(state.connection, password)
          try {
            await ensureSchema(client)
            if (!(await verifyKeyAgainstRemote(client, syncKey))) return SYNC_KEY_ERROR
          } finally {
            await client.end().catch(() => undefined)
          }
        } catch (error) {
          console.error('[cloud-sync] 校验同步密钥失败', error)
          return errorMessage(error)
        }
      }
    }
    store.set('syncKeyBlob', safeStorage.encryptString(syncKey).toString('base64'))
    store.set('shadow', {})
    broadcastState()
    return null
  })

  ipcMain.handle(IPC.CloudSyncSetEnabled, async (_e, enabled: boolean): Promise<string | null> => {
    if (enabled) {
      const state = persisted()
      if (!state.connection) return '请先保存数据库连接参数'
      if (!state.syncKeyBlob) return '请先生成或填写同步密钥'
      store.set('enabled', true)
      broadcastState()
      return await syncNow()
    }
    store.set('enabled', false)
    lastError = undefined
    broadcastState()
    return null
  })

  ipcMain.handle(IPC.CloudSyncSyncNow, () => syncNow())

  ipcMain.handle(IPC.CloudSyncClearRemote, async (): Promise<string | null> => {
    try {
      const { client } = await openVerifiedClient()
      try {
        await deleteAllRemoteRecords(client)
      } finally {
        await client.end().catch(() => undefined)
      }
      store.set('shadow', {})
      broadcastState()
      return null
    } catch (error) {
      const classified = classifyError(error)
      console.error('[cloud-sync] 清空云端数据失败', classified.message)
      return classified.message
    }
  })
}
