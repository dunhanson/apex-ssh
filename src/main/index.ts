import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import type { ConflictPolicy, DetachedSessionInfo, DownloadItem, HostConfig, HostInput, SftpEntry, SftpListResult, TermSize } from '@shared/types'
import { IPC } from '@shared/types'
import {
  addHost,
  createHostBackup,
  deleteHost,
  importHosts,
  listHosts,
  parseHostBackup,
  updateHost
} from './hosts'
import { clearRecents, listRecents, removeRecent } from './recents'
import { listSshConfig } from './sshconfig'
import * as creds from './credentials'
import * as settings from './settings'
import * as sftp from './sftp'
import * as ssh from './ssh'
import { initUpdater, registerUpdaterIpc } from './updater'
import {
  decryptCompleteBackup,
  encryptCompleteBackup,
  MAX_ENCRYPTED_BACKUP_BYTES,
  parseEncryptedContainer,
  restrictBackupFilePermissions,
  type CompleteBackupPayload
} from './encrypted-backup'
import {
  createCompleteBackupPayload,
  getCompleteBackupStats,
  importCompleteBackupPayload
} from './complete-backup'

// Windows 下被完全遮挡的窗口会被 Chromium 判定为 hidden 并停止 BeginFrame，
// xterm 的渲染循环（rAF 驱动）随之停摆；终端应用需要遮挡时也能持续渲染
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

/** 迁出会话的终端快照：sessionId → snapshot（新窗口 attach 后清掉） */
const detachedSnapshots = new Map<string, string>()

interface PendingEncryptedImport {
  container: unknown
  payload?: CompleteBackupPayload
  expires: NodeJS.Timeout
}

const pendingEncryptedImports = new Map<number, PendingEncryptedImport>()

function clearPendingEncryptedImport(webContentsId: number): void {
  const pending = pendingEncryptedImports.get(webContentsId)
  if (pending) clearTimeout(pending.expires)
  pendingEncryptedImports.delete(webContentsId)
}

function setPendingEncryptedImport(webContentsId: number, value: Omit<PendingEncryptedImport, 'expires'>): void {
  clearPendingEncryptedImport(webContentsId)
  const expires = setTimeout(() => clearPendingEncryptedImport(webContentsId), 5 * 60 * 1000)
  expires.unref()
  pendingEncryptedImports.set(webContentsId, { ...value, expires })
}

function baseWindowOptions(width: number, height: number) {
  return {
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    title: 'Apex SSH',
    icon: join(__dirname, '../../resources/icon.png'),
    frame: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 窗口被遮挡/最小化时 Chromium 默认暂停 rAF，xterm 的 DOM 渲染将完全停止；
      // 终端应用需要遮挡时也能持续渲染
      backgroundThrottling: false
    }
  } as const
}

function wireWindow(win: BrowserWindow): void {
  win.on('maximize', () => win.webContents.send(IPC.WindowMaximized, true))
  win.on('unmaximize', () => win.webContents.send(IPC.WindowMaximized, false))
  // 窗口销毁后，其名下尚未迁出的会话成为孤儿，直接断开
  win.on('closed', () => ssh.disconnectOrphans())
  win.show()
  win.focus()
}

/**
 * 主进程入口：创建主窗口并注册全部 IPC handler。
 * 窗口为无边框（frameless），最小化 / 最大化 / 关闭三键由渲染端自绘。
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow(baseWindowOptions(1280, 800))

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  // 部分环境下窗口创建后 Chromium 侧仍处于 hidden 状态（rAF 停摆、终端不渲染），显式唤起
  wireWindow(win)
  return win
}

/** 「移到新窗口」：为被迁出的会话创建独立窗口（?detached=<sessionId>），通道保持不断 */
function createDetachedWindow(sessionId: string, snapshot: string): void {
  if (!ssh.has(sessionId)) return
  detachedSnapshots.set(sessionId, snapshot)

  const win = new BrowserWindow({ ...baseWindowOptions(960, 640) })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?detached=${sessionId}`)
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: { detached: sessionId }
    })
  }
  wireWindow(win)
  win.on('closed', () => {
    // 独立窗口关闭 = 关闭该会话（disconnectOrphans 也会兜到，这里明确语义）
    detachedSnapshots.delete(sessionId)
    ssh.disconnect(sessionId)
  })
}

function registerIpc(): void {
  ipcMain.handle(IPC.Ping, () => 'pong')
  ipcMain.handle(IPC.ClipboardWriteText, (_e, text: string) => {
    clipboard.writeText(text)
    return clipboard.readText() === text
  })
  ipcMain.handle(IPC.ClipboardReadText, () => clipboard.readText())

  ipcMain.handle(IPC.HostsList, () => listHosts())
  ipcMain.handle(IPC.HostsAdd, (_e, input: HostInput) => addHost(input))
  ipcMain.handle(IPC.HostsDelete, (_e, id: string) => deleteHost(id))
  ipcMain.handle(IPC.HostsUpdate, (_e, id: string, input: HostInput) => updateHost(id, input))
  ipcMain.handle(IPC.HostsExport, async (e, options?: { includeCredentials?: boolean; password?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (options?.includeCredentials) {
      const payload = createCompleteBackupPayload()
      const encrypted = await encryptCompleteBackup(payload, options.password ?? '')
      const result = await dialog.showSaveDialog(win!, {
        title: '导出加密完整备份',
        defaultPath: `apex-complete-${new Date().toISOString().slice(0, 10)}.apex-backup`,
        filters: [{ name: 'Apex 加密备份', extensions: ['apex-backup'] }]
      })
      if (result.canceled || !result.filePath) {
        return { status: 'cancelled', count: 0, encrypted: true }
      }
      await fsp.writeFile(result.filePath, encrypted, { encoding: 'utf8', mode: 0o600 })
      try {
        await restrictBackupFilePermissions(result.filePath)
      } catch (error) {
        await fsp.rm(result.filePath, { force: true })
        throw error
      }
      return {
        status: 'success',
        count: payload.hosts.length,
        encrypted: true,
        stats: payload.stats
      }
    }
    const backup = createHostBackup(creds.listKeys(), creds.listPasswords())
    const result = await dialog.showSaveDialog(win!, {
      title: '导出主机配置备份',
      defaultPath: `apex-hosts-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Apex 主机备份', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { status: 'cancelled', count: 0 }
    }
    await fsp.writeFile(result.filePath, `${JSON.stringify(backup, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    return {
      status: 'success',
      count: backup.hosts.length,
      omittedSecrets: backup.security.omittedSecrets
    }
  })
  ipcMain.handle(IPC.HostsImport, async (e, options?: { includeCredentials?: boolean }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const picked = await dialog.showOpenDialog(win!, {
      title: '导入主机配置备份',
      properties: ['openFile'],
      filters: options?.includeCredentials
        ? [{ name: 'Apex 加密备份', extensions: ['apex-backup'] }]
        : [{ name: 'Apex 主机备份', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) {
      return { status: 'cancelled', count: 0 }
    }
    const file = picked.filePaths[0]
    const fileSize = (await fsp.stat(file)).size
    if (fileSize > MAX_ENCRYPTED_BACKUP_BYTES) {
      throw new Error('备份文件不能超过 50 MB')
    }
    const value = JSON.parse(await fsp.readFile(file, 'utf8')) as unknown
    if (
      value &&
      typeof value === 'object' &&
      'format' in value &&
      value.format === 'apex-encrypted-backup'
    ) {
      if (!options?.includeCredentials) {
        throw new Error('请开启“包含登录凭证”后导入加密备份')
      }
      const container = parseEncryptedContainer(value)
      setPendingEncryptedImport(e.sender.id, { container })
      return { status: 'password-required', count: 0, encrypted: true }
    }
    if (options?.includeCredentials) throw new Error('所选文件不是 Apex 加密备份')
    if (fileSize > 5 * 1024 * 1024) throw new Error('普通主机备份文件不能超过 5 MB')
    const backup = parseHostBackup(value)
    const confirmation = await dialog.showMessageBox(win!, {
      type: 'question',
      title: '导入主机配置',
      message: `备份中包含 ${backup.hosts.length} 台主机`,
      detail:
        '合并会按主机 ID 更新已有配置并保留其他主机；替换会删除当前全部主机。密码、私钥内容和私钥口令不会从备份导入。',
      buttons: ['取消', '合并', '替换'],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    })
    if (confirmation.response === 0) return { status: 'cancelled', count: 0 }
    const result = importHosts(backup.hosts, confirmation.response === 2 ? 'replace' : 'merge')
    const localKeyIds = new Set(creds.listKeys().map((entry) => entry.id))
    const localPasswordIds = new Set(creds.listPasswords().map((entry) => entry.id))
    const unresolvedCredentials = backup.hosts.filter((host) =>
      host.auth.type === 'key'
        ? !!host.auth.keyId && !localKeyIds.has(host.auth.keyId)
        : !!host.auth.passwordId && !localPasswordIds.has(host.auth.passwordId)
    ).length
    return {
      status: 'success',
      count: backup.hosts.length,
      ...result,
      unresolvedCredentials,
      omittedSecrets: backup.security.omittedSecrets
    }
  })
  ipcMain.handle(IPC.HostsImportUnlock, async (e, password: string) => {
    const pending = pendingEncryptedImports.get(e.sender.id)
    if (!pending) throw new Error('待导入的加密备份已失效，请重新选择文件')
    const payload = await decryptCompleteBackup(pending.container, password)
    setPendingEncryptedImport(e.sender.id, { container: pending.container, payload })
    return {
      status: 'preview',
      count: payload.hosts.length,
      encrypted: true,
      stats: payload.stats
    }
  })
  ipcMain.handle(IPC.HostsImportCommit, async (e, mode: 'merge' | 'replace') => {
    const pending = pendingEncryptedImports.get(e.sender.id)
    if (!pending?.payload) throw new Error('加密备份尚未解锁或已失效')
    if (mode !== 'merge' && mode !== 'replace') throw new Error('导入模式无效')
    try {
      const result = await importCompleteBackupPayload(pending.payload, mode)
      return {
        status: 'success',
        count: pending.payload.hosts.length,
        encrypted: true,
        stats: pending.payload.stats,
        ...result
      }
    } finally {
      clearPendingEncryptedImport(e.sender.id)
    }
  })
  ipcMain.handle(IPC.HostsImportCancel, (e) => {
    clearPendingEncryptedImport(e.sender.id)
  })
  ipcMain.handle(IPC.HostsBackupStats, () => getCompleteBackupStats())

  ipcMain.handle(IPC.RecentsList, () => listRecents())
  ipcMain.handle(IPC.RecentsRemove, (_e, hostId: string) => removeRecent(hostId))
  ipcMain.handle(IPC.RecentsClear, () => clearRecents())

  ipcMain.handle(IPC.SshConfigList, () => listSshConfig())

  ipcMain.handle(IPC.DialogPickFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择私钥文件',
      properties: ['openFile', 'showHiddenFiles']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.DialogPickFiles, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections', 'showHiddenFiles']
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IPC.DialogPickDirectory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择要上传的文件夹',
      properties: ['openDirectory', 'showHiddenFiles']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.SshConnect, (e, sessionId: string, host: HostConfig, size: TermSize) => {
    ssh.connect(e.sender, sessionId, host, size)
  })
  ipcMain.on(IPC.SshWrite, (_e, sessionId: string, data: string) => ssh.write(sessionId, data))
  ipcMain.on(IPC.SshResize, (_e, sessionId: string, cols: number, rows: number) =>
    ssh.resize(sessionId, cols, rows)
  )
  ipcMain.on(IPC.SshDisconnect, (_e, sessionId: string) => ssh.disconnect(sessionId))

  ipcMain.on(IPC.WindowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on(IPC.WindowToggleMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.WindowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle(IPC.WindowIsMaximized, (e) =>
    BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  )

  ipcMain.on(IPC.WindowOpenDetached, (_e, sessionId: string, snapshot: string) =>
    createDetachedWindow(sessionId, snapshot)
  )
  ipcMain.handle(IPC.SessionAttach, (e, sessionId: string): DetachedSessionInfo | null => {
    const host = ssh.getHost(sessionId)
    const snapshot = detachedSnapshots.get(sessionId)
    if (!host || snapshot === undefined) return null
    // 数据流改投新窗口，原窗口的标签由渲染端自行移除（不触发断开）
    ssh.retarget(sessionId, e.sender)
    return { sessionId, host, snapshot }
  })

  ipcMain.handle(IPC.SftpHome, (_e, sessionId: string) => sftp.home(sessionId))
  ipcMain.handle(IPC.SftpList, (_e, sessionId: string, path: string) => sftp.list(sessionId, path))
  ipcMain.handle(IPC.SftpMkdir, (_e, sessionId: string, path: string) => sftp.mkdir(sessionId, path))
  ipcMain.handle(IPC.SftpRename, (_e, sessionId: string, oldPath: string, newPath: string) =>
    sftp.rename(sessionId, oldPath, newPath)
  )
  ipcMain.handle(IPC.SftpRemove, (_e, sessionId: string, paths: string[]) => sftp.remove(sessionId, paths))
  ipcMain.handle(IPC.SftpUpload, (e, sessionId: string, taskId: string, localPaths: string[], remoteDir: string) =>
    sftp.startUpload(e.sender, sessionId, taskId, localPaths, remoteDir)
  )
  ipcMain.handle(IPC.SftpDownload, (e, sessionId: string, taskId: string, items: DownloadItem[], conflict: ConflictPolicy) =>
    sftp.startDownload(e.sender, sessionId, taskId, items, conflict)
  )
  ipcMain.handle(IPC.SftpPickDownload, async (e, _sessionId: string, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const lastDir = settings.getLastDownloadDir()
    const result = await dialog.showSaveDialog(win!, {
      title: '下载到本地',
      defaultPath: lastDir ? join(lastDir, suggestedName) : suggestedName
    })
    if (result.canceled || !result.filePath) return null
    settings.setLastDownloadDir(dirname(result.filePath))
    return result.filePath
  })
  ipcMain.handle(IPC.SftpPickDownloadDir, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择下载目录',
      defaultPath: settings.getLastDownloadDir() || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    settings.setLastDownloadDir(result.filePaths[0])
    return result.filePaths[0]
  })
  ipcMain.on(IPC.SftpPause, (_e, taskId: string) => sftp.pauseTransfer(taskId))
  ipcMain.on(IPC.SftpResume, (_e, taskId: string) => sftp.resumeTransfer(taskId))
  ipcMain.on(IPC.SftpCancel, (_e, taskId: string) => sftp.cancelTransfer(taskId))

  ipcMain.handle(IPC.CredsListKeys, () => creds.listKeys())
  ipcMain.handle(IPC.CredsGenerateKey, (_e, name: string) => creds.generateKey(name))
  ipcMain.handle(IPC.CredsImportKey, (_e, name: string, sourcePath: string) =>
    creds.importKey(name, sourcePath)
  )
  ipcMain.handle(IPC.CredsReplaceKey, (_e, id: string, sourcePath: string) =>
    creds.replaceKey(id, sourcePath)
  )
  ipcMain.handle(IPC.CredsRenameKey, (_e, id: string, name: string) =>
    creds.renameKey(id, name)
  )
  ipcMain.handle(IPC.CredsDeleteKey, (_e, id: string) => creds.deleteKey(id))
  ipcMain.handle(IPC.CredsListPasswords, () => creds.listPasswords())
  ipcMain.handle(IPC.CredsAddPassword, (_e, label: string, password: string) =>
    creds.addPassword(label, password)
  )
  ipcMain.handle(IPC.CredsUpdatePassword, (_e, id: string, label: string, password: string) =>
    creds.updatePassword(id, label, password)
  )
  ipcMain.handle(IPC.CredsDeletePassword, (_e, id: string) => creds.deletePassword(id))

  ipcMain.handle(IPC.SettingsGet, () => settings.getSettings())
  ipcMain.handle(IPC.SettingsSet, (_e, patch: Parameters<typeof settings.setSettings>[0]) =>
    settings.setSettings(patch)
  )

  registerUpdaterIpc()

  ipcMain.handle(IPC.LocalHome, () => homedir())
  ipcMain.handle(IPC.LocalList, async (_e, path: string): Promise<SftpListResult> => {
    try {
      const items = await fsp.readdir(path, { withFileTypes: true })
      const entries: SftpEntry[] = []
      for (const item of items) {
        if (item.name === '.' || item.name === '..') continue
        const full = join(path, item.name)
        try {
          const stat = await fsp.stat(full)
          entries.push({
            name: item.name,
            path: full,
            type: item.isDirectory() ? 'dir' : item.isSymbolicLink() ? 'link' : 'file',
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs / 1000),
            permissions: ''
          })
        } catch {
          /* 无权限的条目跳过 */
        }
      }
      entries.sort((a, b) => (a.type === 'dir' ? -1 : 1) - (b.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name))
      return { path, entries }
    } catch (err) {
      return { path, entries: [], error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.LocalRename, async (_e, path: string, name: string): Promise<string | null> => {
    try {
      const nextName = name.trim()
      if (!nextName || nextName === '.' || nextName === '..' || basename(nextName) !== nextName) {
        throw new Error('文件名不能包含路径分隔符')
      }
      const source = resolve(path)
      if (source === parse(source).root) throw new Error('不能重命名文件系统根目录')
      await fsp.rename(source, join(dirname(source), nextName))
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })
  ipcMain.handle(IPC.LocalRemove, async (_e, paths: string[]): Promise<string | null> => {
    try {
      const targets = paths.map((path) => resolve(path))
      if (targets.some((path) => path === parse(path).root)) {
        throw new Error('不能删除文件系统根目录')
      }
      for (const path of targets) await fsp.rm(path, { recursive: true })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  // 后台初始化更新服务：仅打包后的 Windows 生效，内部延迟触发首次检查
  initUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ssh.disconnectAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ssh.disconnectAll()
})
