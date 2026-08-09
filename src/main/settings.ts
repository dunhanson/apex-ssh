import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import type { AppSettings } from '@shared/types'
import { IPC } from '@shared/types'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings-values'

/**
 * 应用设置持久化：终端、界面、传输及非敏感备份偏好。
 * set 后广播 SettingsChanged 给所有窗口，终端与 i18n 即时生效。
 * 上次下载目录（lastDownloadDir）静默记录，不进入设置界面。
 */
const store = new Store<{ settings: AppSettings; lastDownloadDir: string }>({
  // conf 无法从 CJS 主进程推断包名，需显式指定；electron-store v11 类型定义未暴露该字段，运行时有效
  // @ts-expect-error projectName 在 conf v15 运行时有效
  projectName: 'apex-ssh',
  name: 'apex-settings',
  defaults: { settings: DEFAULT_SETTINGS, lastDownloadDir: '' }
})

export function getSettings(): AppSettings {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...store.get('settings', DEFAULT_SETTINGS)
  })
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = normalizeSettings({ ...getSettings(), ...patch })
  store.set('settings', next)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.SettingsChanged, next)
  }
  return next
}

/** 下载对话框的默认目录：上次选择 > 设置的默认目录 > 空（系统默认） */
export function getLastDownloadDir(): string {
  return store.get('lastDownloadDir', '') || getSettings().downloadDir
}

export function setLastDownloadDir(dir: string): void {
  store.set('lastDownloadDir', dir)
}
