import type { Client, SFTPWrapper } from 'ssh2'
import type { Stats } from 'ssh2'
import { promises as fsp } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, BrowserWindow, Notification, type WebContents } from 'electron'
import type { ConflictPolicy, DownloadItem, SftpEntry, SftpListResult, TransferProgress, TransferStatus } from '@shared/types'
import { IPC } from '@shared/types'
import { getSettings } from './settings'
import { getClient, getCurrentDirectory } from './ssh'

/**
 * SFTP 通道与传输引擎：复用会话的 ssh2 Client 开 sftp 子系统。
 * 传输为手动分块拷贝（256KB），由此获得精确的暂停 / 续传（按偏移量）/ 取消控制；
 * 进度经 sftp:progress 事件推送渲染端。传输在独立回调链上跑，不阻塞 shell 通道。
 * 下载支持批量项与目录递归，本地同名冲突按任务级策略（覆盖 / 跳过 / 自动重命名）处理。
 */

// ── 基础工具 ────────────────────────────────────────────────

const CHUNK = 256 * 1024
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
  })
}

function sftpStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, stats) => (err ? reject(err) : resolve(stats)))
  })
}

function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<{ filename: string; longname: string; attrs: Stats }[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => (err ? reject(err) : resolve(list)))
  })
}

function sftpMkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, (err) => (err ? reject(err) : resolve()))
  })
}

function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()))
  })
}

function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err) => (err ? reject(err) : resolve()))
  })
}

function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(path, (err) => (err ? reject(err) : resolve()))
  })
}

function sftpRealpath(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(path, (err, resolved) => (err ? reject(err) : resolve(resolved)))
  })
}

function sftpOpen(sftp: SFTPWrapper, path: string, flags: Parameters<SFTPWrapper['open']>[1]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, flags, (err, handle) => (err ? reject(err) : resolve(handle)))
  })
}

function sftpRead(sftp: SFTPWrapper, handle: Buffer, buf: Buffer, position: number): Promise<number> {
  return new Promise((resolve, reject) => {
    sftp.read(handle, buf, 0, buf.length, position, (err, bytesRead) =>
      err ? reject(err) : resolve(bytesRead)
    )
  })
}

function sftpWrite(sftp: SFTPWrapper, handle: Buffer, buf: Buffer, length: number, position: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buf, 0, length, position, (err) => (err ? reject(err) : resolve()))
  })
}

function sftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve) => {
    sftp.close(handle, () => resolve())
  })
}

/** 权限位 → rwxr-xr-x 字符串 */
function modeString(mode: number): string {
  const flags = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  const o = (mode >> 6) & 7
  const g = (mode >> 3) & 7
  const p = mode & 7
  return `${flags[o]}${flags[g]}${flags[p]}`
}

function toEntry(parentPath: string, filename: string, attrs: Stats): SftpEntry {
  const type: SftpEntry['type'] = attrs.isDirectory()
    ? 'dir'
    : attrs.isSymbolicLink()
      ? 'link'
      : attrs.isFile()
        ? 'file'
        : 'other'
  return {
    name: filename,
    path: parentPath === '/' ? `/${filename}` : `${parentPath}/${filename}`,
    type,
    size: attrs.size,
    mtime: attrs.mtime,
    permissions: modeString(attrs.mode & 0o777)
  }
}

// ── 目录操作 IPC 实现 ───────────────────────────────────────

export async function home(sessionId: string): Promise<string> {
  const client = getClient(sessionId)
  if (!client) throw new Error('会话不存在或已断开')

  // SFTP 面板跟随当前交互式 Shell 的 pwd；Shell 忙碌或不兼容时回退到登录目录。
  try {
    const currentDirectory = await getCurrentDirectory(sessionId)
    if (currentDirectory.startsWith('/')) return currentDirectory
  } catch {
    /* 继续使用 SFTP 登录目录 */
  }

  const sftp = await getSftp(client)
  try {
    return await sftpRealpath(sftp, '.')
  } finally {
    // 每个 SFTP 子系统是一条 SSH 通道，OpenSSH MaxSessions（默认 10）用尽后
    // 后续 client.sftp() 会挂死——用完必须 end 释放
    sftp.end()
  }
}

export async function list(sessionId: string, path: string): Promise<SftpListResult> {
  const client = getClient(sessionId)
  if (!client) return { path, entries: [], error: '会话不存在或已断开' }
  try {
    const sftp = await getSftp(client)
    try {
      const items = await sftpReaddir(sftp, path)
      const entries = items
        .filter((i) => i.filename !== '.' && i.filename !== '..')
        .map((i) => toEntry(path, i.filename, i.attrs))
        // 目录在前，名称排序
        .sort((a, b) => (a.type === 'dir' ? -1 : 1) - (b.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name))
      return { path, entries }
    } finally {
      sftp.end()
    }
  } catch (err) {
    return { path, entries: [], error: err instanceof Error ? err.message : String(err) }
  }
}

export async function mkdir(sessionId: string, path: string): Promise<string | null> {
  const client = getClient(sessionId)
  if (!client) return '会话不存在或已断开'
  try {
    const sftp = await getSftp(client)
    try {
      await sftpMkdir(sftp, path)
      return null
    } finally {
      sftp.end()
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export async function rename(sessionId: string, oldPath: string, newPath: string): Promise<string | null> {
  const client = getClient(sessionId)
  if (!client) return '会话不存在或已断开'
  try {
    const sftp = await getSftp(client)
    try {
      await sftpRename(sftp, oldPath, newPath)
      return null
    } finally {
      sftp.end()
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** 递归删除（目录先清空子项再 rmdir）；部分失败不中断，返回首个错误 */
export async function remove(sessionId: string, paths: string[]): Promise<string | null> {
  const client = getClient(sessionId)
  if (!client) return '会话不存在或已断开'
  let firstErr: string | null = null
  try {
    const sftp = await getSftp(client)
    try {
      for (const path of paths) {
        await removePath(sftp, path).catch((err) => {
          firstErr ??= err instanceof Error ? err.message : String(err)
        })
      }
    } finally {
      sftp.end()
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  return firstErr
}

async function removePath(sftp: SFTPWrapper, path: string): Promise<void> {
  const stats = await sftpStat(sftp, path)
  if (stats.isDirectory()) {
    const items = await sftpReaddir(sftp, path)
    for (const item of items) {
      if (item.filename === '.' || item.filename === '..') continue
      await removePath(sftp, path === '/' ? `/${item.filename}` : `${path}/${item.filename}`)
    }
    await sftpRmdir(sftp, path)
  } else {
    await sftpUnlink(sftp, path)
  }
}

// ── 传输引擎 ────────────────────────────────────────────────

interface TransferTask {
  taskId: string
  sessionId: string
  direction: 'up' | 'down'
  status: TransferStatus
  transferred: number
  total: number
  paused: boolean
  cancelled: boolean
  startedAt: number | null
  wc: WebContents
}

interface TransferJob {
  task: TransferTask
  run: () => Promise<void>
}

const tasks = new Map<string, TransferTask>()
const pendingJobs: TransferJob[] = []
let activeTransfers = 0

function emitProgress(task: TransferTask, message?: string): void {
  if (task.wc.isDestroyed()) return
  const payload: TransferProgress = {
    sessionId: task.sessionId,
    taskId: task.taskId,
    transferred: task.transferred,
    total: task.total,
    status: task.status,
    message
  }
  task.wc.send(IPC.SftpProgress, payload)
}

function showCompletionNotification(task: TransferTask): void {
  const settings = getSettings()
  if (!settings.notifyTransferComplete || !Notification.isSupported()) return
  const duration = task.startedAt === null ? 0 : Date.now() - task.startedAt
  const appFocused = BrowserWindow.getAllWindows().some((window) => window.isFocused())
  if (appFocused && duration < 10_000) return
  const locale = settings.language === 'system' ? app.getLocale() : settings.language
  const zh = locale.toLowerCase().startsWith('zh')
  const body =
    task.direction === 'up'
      ? zh
        ? '上传完成'
        : 'Upload complete'
      : zh
        ? '下载完成'
        : 'Download complete'
  new Notification({
    title: 'Apex SSH',
    body
  }).show()
}

async function runTransferJob(job: TransferJob): Promise<void> {
  const { task } = job
  task.status = 'running'
  task.startedAt = Date.now()
  emitProgress(task)
  let message: string | undefined
  try {
    await job.run()
    if (task.status === 'running') task.status = 'done'
  } catch (err) {
    if (task.cancelled) {
      task.status = 'cancelled'
    } else {
      task.status = 'error'
      message = err instanceof Error ? err.message : String(err)
    }
  } finally {
    activeTransfers = Math.max(0, activeTransfers - 1)
    try {
      emitProgress(task, message)
      if (task.status === 'done') showCompletionNotification(task)
    } catch {
      // 通知或窗口销毁竞态不能阻塞后续排队任务。
    } finally {
      pumpTransferQueue()
    }
  }
}

function pumpTransferQueue(): void {
  const limit = getSettings().maxConcurrentTransfers
  while (activeTransfers < limit && pendingJobs.length > 0) {
    const job = pendingJobs.shift()!
    if (job.task.cancelled) continue
    activeTransfers += 1
    void runTransferJob(job)
  }
}

function enqueueTransfer(task: TransferTask, run: () => Promise<void>): void {
  tasks.set(task.taskId, task)
  pendingJobs.push({ task, run })
  emitProgress(task)
  pumpTransferQueue()
}

/** 设置提高并发上限后立即尝试放行等待任务。 */
export function refreshTransferQueue(): void {
  pumpTransferQueue()
}

/** 暂停点：暂停时自旋等待，取消时抛错中断 */
async function checkpoint(task: TransferTask): Promise<void> {
  if (task.cancelled) throw new Error('__cancelled__')
  while (task.paused && !task.cancelled) await sleep(200)
  if (task.cancelled) throw new Error('__cancelled__')
}

export function pauseTransfer(taskId: string): void {
  const task = tasks.get(taskId)
  if (task && task.status === 'running') {
    task.paused = true
    task.status = 'paused'
    emitProgress(task)
  }
}

export function resumeTransfer(taskId: string): void {
  const task = tasks.get(taskId)
  if (task && task.status === 'paused') {
    task.paused = false
    task.status = 'running'
    emitProgress(task)
  }
}

export function cancelTransfer(taskId: string): void {
  const task = tasks.get(taskId)
  if (!task) return
  task.cancelled = true
  task.paused = false
  if (task.status === 'queued') {
    const index = pendingJobs.findIndex((job) => job.task.taskId === taskId)
    if (index >= 0) pendingJobs.splice(index, 1)
    task.status = 'cancelled'
    emitProgress(task)
    pumpTransferQueue()
  } else if (task.status === 'running' || task.status === 'paused') {
    task.status = 'cancelled'
    emitProgress(task)
  }
}

/** 上传单文件（按偏移量续传：offset 之前的内容跳过） */
async function uploadFile(
  sftp: SFTPWrapper,
  task: TransferTask,
  localPath: string,
  remotePath: string,
  size: number
): Promise<void> {
  // 远端已有部分 → 从断点继续（不信任本地记录，以远端实际大小为准）
  let offset = 0
  try {
    const remote = await sftpStat(sftp, remotePath)
    offset = Math.min(remote.size, size)
  } catch {
    /* 远端不存在，从头传 */
  }
  if (offset >= size) {
    task.transferred += size
    emitProgress(task)
    return
  }

  const handle = await sftpOpen(sftp, remotePath, 'r+').catch(() => sftpOpen(sftp, remotePath, 'w'))
  const fd = await fsp.open(localPath, 'r')
  const buf = Buffer.allocUnsafe(CHUNK)
  try {
    let pos = offset
    task.transferred += offset
    while (pos < size) {
      await checkpoint(task)
      const { bytesRead } = await fd.read(buf, 0, Math.min(CHUNK, size - pos), pos)
      if (bytesRead === 0) break
      await sftpWrite(sftp, handle, buf, bytesRead, pos)
      pos += bytesRead
      task.transferred += bytesRead
      emitProgress(task)
    }
  } finally {
    await fd.close()
    await sftpClose(sftp, handle)
  }
}

/** 递归展开本地上传路径（文件夹含嵌套结构），逐文件上传 */
async function uploadPath(
  sftp: SFTPWrapper,
  task: TransferTask,
  localPath: string,
  remoteDir: string
): Promise<void> {
  const stat = await fsp.stat(localPath)
  const name = basename(localPath)
  const remotePath = remoteDir === '/' ? `/${name}` : `${remoteDir}/${name}`
  if (stat.isDirectory()) {
    await sftpMkdir(sftp, remotePath).catch(() => {
      /* 已存在则忽略 */
    })
    const items = await fsp.readdir(localPath)
    for (const item of items) {
      await checkpoint(task)
      await uploadPath(sftp, task, join(localPath, item), remotePath)
    }
  } else {
    await uploadFile(sftp, task, localPath, remotePath, stat.size)
  }
}

/** 预扫描总字节数（用于进度条与「完成后文件才出现」的语义无关，仅统计） */
async function scanSize(localPath: string): Promise<number> {
  const stat = await fsp.stat(localPath)
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const item of await fsp.readdir(localPath)) {
    total += await scanSize(join(localPath, item))
  }
  return total
}

export async function startUpload(
  wc: WebContents,
  sessionId: string,
  taskId: string,
  localPaths: string[],
  remoteDir: string
): Promise<{ total: number } | { error: string }> {
  const client = getClient(sessionId)
  if (!client) return { error: '会话不存在或已断开' }
  let total = 0
  try {
    for (const p of localPaths) total += await scanSize(p)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const task: TransferTask = {
    taskId,
    sessionId,
    direction: 'up',
    status: 'queued',
    transferred: 0,
    total,
    paused: false,
    cancelled: false,
    startedAt: null,
    wc
  }

  enqueueTransfer(task, async () => {
    const activeClient = getClient(sessionId)
    if (!activeClient) throw new Error('会话不存在或已断开')
    const sftp = await getSftp(activeClient).catch(() => null)
    if (!sftp) throw new Error('SFTP 通道打开失败')
    try {
      for (const p of localPaths) {
        await checkpoint(task)
        await uploadPath(sftp, task, p, remoteDir)
      }
    } finally {
      sftp.end()
    }
  })

  return { total }
}

/** 下载单文件到本地路径：本地已存在视为冲突，按策略改写目标（调用方保证已决策） */
async function downloadFile(
  sftp: SFTPWrapper,
  task: TransferTask,
  remotePath: string,
  localPath: string,
  size: number
): Promise<void> {
  const handle = await sftpOpen(sftp, remotePath, 'r')
  await fsp.mkdir(dirname(localPath), { recursive: true })
  const fd = await fsp.open(localPath, 'w')
  const buf = Buffer.allocUnsafe(CHUNK)
  try {
    let pos = 0
    while (pos < size) {
      await checkpoint(task)
      const bytesRead = await sftpRead(sftp, handle, buf, pos)
      if (bytesRead === 0) break
      await fd.write(buf, 0, bytesRead, pos)
      pos += bytesRead
      task.transferred += bytesRead
      emitProgress(task)
    }
  } finally {
    await fd.close()
    await sftpClose(sftp, handle)
  }
}

/** 本地目标已存在时按策略求最终落点；skip 返回 null，rename 生成「name (1).ext」 */
async function resolveConflict(localPath: string, policy: ConflictPolicy): Promise<string | null> {
  const exists = await fsp.stat(localPath).then(() => true).catch(() => false)
  if (!exists) return localPath
  if (policy === 'overwrite') return localPath
  if (policy === 'skip') return null
  const dir = dirname(localPath)
  const ext = extname(localPath)
  const stem = basename(localPath, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, `${stem} (${i})${ext}`)
    const taken = await fsp.stat(candidate).then(() => true).catch(() => false)
    if (!taken) return candidate
  }
  return null
}

/** 递归下载远程文件/目录到本地落点，目录冲突的 overwrite 语义为合并进入 */
async function downloadPath(
  sftp: SFTPWrapper,
  task: TransferTask,
  remotePath: string,
  localPath: string,
  policy: ConflictPolicy
): Promise<void> {
  const stats = await sftpStat(sftp, remotePath)
  if (stats.isDirectory()) {
    const exists = await fsp.stat(localPath).then(() => true).catch(() => false)
    let target = localPath
    if (exists) {
      if (policy === 'skip') return
      if (policy === 'rename') {
        const renamed = await resolveConflict(localPath, policy)
        if (!renamed) return
        target = renamed
      }
    }
    await fsp.mkdir(target, { recursive: true })
    const items = await sftpReaddir(sftp, remotePath)
    for (const item of items) {
      if (item.filename === '.' || item.filename === '..') continue
      await checkpoint(task)
      await downloadPath(
        sftp,
        task,
        remotePath === '/' ? `/${item.filename}` : `${remotePath}/${item.filename}`,
        join(target, item.filename),
        policy
      )
    }
  } else {
    const target = await resolveConflict(localPath, policy)
    if (!target) {
      task.transferred += stats.size
      emitProgress(task)
      return
    }
    await downloadFile(sftp, task, remotePath, target, stats.size)
  }
}

/** 预扫描远程总字节数（仅用于进度统计） */
async function scanRemoteSize(sftp: SFTPWrapper, remotePath: string): Promise<number> {
  const stats = await sftpStat(sftp, remotePath)
  if (!stats.isDirectory()) return stats.size
  let total = 0
  for (const item of await sftpReaddir(sftp, remotePath)) {
    if (item.filename === '.' || item.filename === '..') continue
    total += await scanRemoteSize(sftp, remotePath === '/' ? `/${item.filename}` : `${remotePath}/${item.filename}`)
  }
  return total
}

export async function startDownload(
  wc: WebContents,
  sessionId: string,
  taskId: string,
  items: DownloadItem[],
  conflict: ConflictPolicy
): Promise<{ total: number } | { error: string }> {
  const client = getClient(sessionId)
  if (!client) return { error: '会话不存在或已断开' }
  const sftp = await getSftp(client).catch(() => null)
  if (!sftp) return { error: 'SFTP 通道打开失败' }
  let total = 0
  try {
    for (const item of items) total += await scanRemoteSize(sftp, item.remotePath)
  } catch (err) {
    sftp.end()
    return { error: err instanceof Error ? err.message : String(err) }
  }
  sftp.end()

  const task: TransferTask = {
    taskId,
    sessionId,
    direction: 'down',
    status: 'queued',
    transferred: 0,
    total,
    paused: false,
    cancelled: false,
    startedAt: null,
    wc
  }

  enqueueTransfer(task, async () => {
    const activeClient = getClient(sessionId)
    if (!activeClient) throw new Error('会话不存在或已断开')
    const transferSftp = await getSftp(activeClient).catch(() => null)
    if (!transferSftp) throw new Error('SFTP 通道打开失败')
    try {
      for (const item of items) {
        await checkpoint(task)
        await downloadPath(transferSftp, task, item.remotePath, item.localPath, conflict)
      }
    } finally {
      transferSftp.end()
    }
  })

  return { total }
}
