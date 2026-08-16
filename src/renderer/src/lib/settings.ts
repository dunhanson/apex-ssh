import { useSyncExternalStore } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * 设置 store（模块级）：启动时拉取，主进程广播 SettingsChanged 时更新。
 * 终端显示与交互参数的实时应用由 TerminalView 订阅本 store 完成。
 */
let current: AppSettings = {
  fontSize: 13,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  scrollOnInput: true,
  copyOnSelect: false,
  confirmMultilinePaste: true,
  language: 'system',
  showSessionInfoBar: true,
  downloadDir: '',
  downloadConflictPolicy: 'ask',
  uploadConflictPolicy: 'ask',
  sftpPanelMode: 'panel',
  doubleClickUpload: true,
  maxConcurrentTransfers: 2,
  notifyTransferComplete: true,
  backupIncludeCredentials: true,
  backupPasswordSource: 'custom',
  monitorRefreshInterval: 5,
  monitorEnabledByDefault: false,
  monitorBackgroundEnabled: false
}
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

window.api.settings.get().then((s) => {
  current = s
  notify()
})
window.api.settings.onChanged((s) => {
  current = s
  notify()
})

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, () => current)
}

export function getSettingsSnapshot(): AppSettings {
  return current
}

export function setSettings(patch: Partial<AppSettings>): void {
  window.api.settings.set(patch)
}
