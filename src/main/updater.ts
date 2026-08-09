import { app, BrowserWindow, ipcMain } from 'electron'
import type { UpdateStatus } from '@shared/types'
import { IPC } from '@shared/types'
import {
  classifyUpdateError,
  createInitialStatus,
  reduceUpdateEvent,
  type UpdateEvent,
  type UpdateMode
} from './updater-state'

/**
 * 应用更新服务（electron-updater + GitHub Releases）。
 *
 * - Windows 安装版（打包）：完整能力——启动后后台检查、自动下载、退出时静默安装、
 *   用户确认后立即安装。
 * - Windows 开发环境（未打包）：仅手动检查（checkOnly），便于开发期验证更新源连通；
 *   不自动后台检查、不下载、不安装。更新源配置走项目根目录 dev-app-update.yml。
 * - 非 Windows：整体不支持，返回 unsupported，不访问更新源。
 * - 渲染端只拿状态快照、触发检查、或在确认后请求立即安装（最小 IPC 白名单）。
 * - 状态机逻辑在 updater-state.ts（纯函数），这里只做事件翻译、广播与 IPC 注册。
 */

/** 当前环境的更新能力模式 */
function updateMode(): UpdateMode {
  if (process.platform !== 'win32') return 'unsupported'
  return app.isPackaged ? 'full' : 'check-only'
}

let status: UpdateStatus | null = null
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null
let checking = false

function current(): UpdateStatus {
  if (!status) status = createInitialStatus(app.getVersion(), updateMode())
  return status
}

function broadcast(): void {
  const snapshot = current()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.UpdaterStatusChanged, snapshot)
  }
}

function dispatch(event: UpdateEvent): void {
  status = reduceUpdateEvent(current(), event)
  broadcast()
}

function dispatchError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  // 原始错误（含 HTTP 头、堆栈）只留在主进程日志，UI 只展示归类后的友好文案
  console.error('[updater]', message)
  dispatch({ type: 'error', message, code: classifyUpdateError(message) })
}

/**
 * 初始化更新服务：注册事件监听；仅安装版启动后台检查。
 * 不支持的环境只初始化状态（unsupported），不加载 electron-updater 行为。
 */
export function initUpdater(): void {
  if (!current().supported) return

  // 延迟到确认支持后再加载，避免不支持的环境加载更新器产生副作用
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater: updater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater = updater

  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  if (current().checkOnly) {
    // 开发环境：使用 dev-app-update.yml 定位更新源，仅手动检查，禁止下载与安装
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = false
  } else {
    // 安装版：检测到稳定版本后后台自动下载；下载完成后不打断用户，正常退出时静默安装
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = true
  }

  autoUpdater.on('checking-for-update', () => dispatch({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => dispatch({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => dispatch({ type: 'not-available' }))
  autoUpdater.on('download-progress', (progress) => dispatch({ type: 'progress', percent: progress.percent }))
  autoUpdater.on('update-downloaded', (info) => dispatch({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', dispatchError)

  if (!current().checkOnly) {
    // 启动后延迟后台检查：不阻塞窗口创建，网络失败只落 error 状态、不弹窗
    const timer = setTimeout(() => void checkForUpdates(), 5000)
    timer.unref()
  }
}

/** 手动 / 后台检查更新；检查或下载进行中时直接返回当前状态 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  const snapshot = current()
  if (!snapshot.supported || !autoUpdater) return snapshot
  if (checking || snapshot.state === 'downloading') return snapshot

  checking = true
  try {
    // 结果经事件流转；checkForUpdates 自身的 rejection 与 error 事件可能重复，统一由 dispatch 兜底
    await autoUpdater.checkForUpdates()
  } catch (error) {
    dispatchError(error)
  } finally {
    checking = false
  }
  return current()
}

/**
 * 用户确认「立即重启更新」后调用：静默安装并重启到新版。
 * 仅 downloaded 状态有效；其他状态（含 checkOnly 开发环境）为空操作，防止渲染端误触发。
 */
export function restartAndInstall(): void {
  if (!autoUpdater || current().checkOnly || current().state !== 'downloaded') return
  dispatch({ type: 'install-requested' })
  // isSilent=true：按用户安装无需 UAC；isForceRunAfter=true：安装后直接启动新版
  autoUpdater.quitAndInstall(true, true)
}

/** 注册更新相关 IPC（白名单：状态查询、检查、立即安装、状态订阅） */
export function registerUpdaterIpc(): void {
  ipcMain.handle(IPC.UpdaterGetStatus, () => current())
  ipcMain.handle(IPC.UpdaterCheck, () => checkForUpdates())
  ipcMain.handle(IPC.UpdaterRestartAndInstall, () => restartAndInstall())
}
