import { useSyncExternalStore } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * 设置 store（模块级）：启动时拉取，主进程广播 SettingsChanged 时更新。
 * 终端参数（字号/光标/回滚）的实时应用由 TerminalView 订阅本 store 完成。
 */
let current: AppSettings = {
  fontSize: 13,
  cursorStyle: 'block',
  scrollback: 5000,
  language: 'system',
  showSessionInfoBar: true,
  downloadDir: '',
  backupIncludeCredentials: true,
  backupPasswordSource: 'custom'
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
