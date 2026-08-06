import type { UpdateErrorCode, UpdateStatus } from '@shared/types'

/**
 * 应用更新状态机（纯函数，不依赖 Electron，便于单元测试）：
 *
 *   idle → checking → downloading → downloaded → installing
 *                ↘ up-to-date        ↘ error
 *                ↘ available（仅 checkOnly 开发环境：发现新版本但不下载）
 *   unsupported：非 Windows，更新能力整体不可用，不再流转
 *
 * 主进程 updater.ts 负责把 electron-updater 事件翻译成这里的 UpdateEvent。
 */

/** 更新能力模式：full=安装版完整更新；check-only=开发环境仅检查；unsupported=不支持 */
export type UpdateMode = 'full' | 'check-only' | 'unsupported'

/** electron-updater 事件翻译后的统一输入 */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string; code: UpdateErrorCode }
  | { type: 'install-requested' }

/** 初始状态：full / check-only 从 idle 开始，unsupported 固定不支持 */
export function createInitialStatus(currentVersion: string, mode: UpdateMode): UpdateStatus {
  return {
    state: mode === 'unsupported' ? 'unsupported' : 'idle',
    supported: mode !== 'unsupported',
    checkOnly: mode === 'check-only',
    currentVersion
  }
}

/**
 * 把 electron-updater 原始错误归类为用户可理解的失败原因。
 * 原始错误（含 HTTP 头、堆栈）只进日志，不直接展示给用户。
 */
export function classifyUpdateError(message: string): UpdateErrorCode {
  const m = message.toLowerCase()
  // 最新 Release 未上传 latest.yml（旧版本发布），或仓库 / 资源 404
  if (/latest[^ ]*\.yml|cannot find|404/.test(m)) return 'no-release'
  if (/err_internet|enotfound|eai_again|etimedout|econnrefused|econnreset|econnaborted|net::|socket hang up|network/.test(m))
    return 'network'
  if (/sha512|checksum|signature|digest|verify/.test(m)) return 'verify'
  return 'unknown'
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/** 状态迁移：非法迁移保持原状态（如 downloading 中收到 not-available 属异常，忽略） */
export function reduceUpdateEvent(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  if (status.state === 'unsupported' || status.state === 'installing') return status

  switch (event.type) {
    case 'checking':
      // downloading / downloaded 期间的手动检查不打断既有进度
      if (status.state === 'downloading' || status.state === 'downloaded') return status
      return { ...status, state: 'checking', message: undefined, errorCode: undefined }
    case 'available':
      // checkOnly（开发环境）只报告发现新版本，不进入下载
      if (status.checkOnly) {
        return { ...status, state: 'available', version: event.version, message: undefined, errorCode: undefined }
      }
      return { ...status, state: 'downloading', version: event.version, progress: 0, message: undefined, errorCode: undefined }
    case 'not-available':
      if (status.state !== 'checking' && status.state !== 'idle') return status
      return { ...status, state: 'up-to-date', version: undefined, progress: undefined, message: undefined, errorCode: undefined }
    case 'progress':
      if (status.state !== 'downloading') return status
      return { ...status, progress: clampPercent(event.percent) }
    case 'downloaded':
      if (status.state !== 'downloading') return status
      return { ...status, state: 'downloaded', version: event.version, progress: 100, message: undefined, errorCode: undefined }
    case 'error':
      // 检查或下载失败均可重试；已下载完成后的安装期错误不回退 downloaded 语义，由安装方兜底
      if (status.state === 'downloaded') return { ...status, message: event.message, errorCode: event.code }
      return { ...status, state: 'error', message: event.message, errorCode: event.code }
    case 'install-requested':
      if (status.state !== 'downloaded') return status
      return { ...status, state: 'installing' }
  }
}
