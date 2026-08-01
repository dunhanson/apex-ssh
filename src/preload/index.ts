import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  ConflictPolicy,
  DetachedSessionInfo,
  DownloadItem,
  HostConfig,
  HostInput,
  RecentEntry,
  RendererApi,
  SessionDataEvent,
  SessionStatusEvent,
  SftpListResult,
  SshConfigEntry,
  TermSize,
  TransferProgress
} from '@shared/types'
import { IPC } from '@shared/types'

/**
 * 预加载桥：渲染进程不直接碰 Node API，只能通过 window.api 白名单调用 IPC。
 * 事件订阅返回取消订阅函数，供 React useEffect 清理。
 */
const api: RendererApi = {
  ping: () => ipcRenderer.invoke(IPC.Ping),

  hosts: {
    list: () => ipcRenderer.invoke(IPC.HostsList),
    add: (input: HostInput) => ipcRenderer.invoke(IPC.HostsAdd, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.HostsDelete, id),
    update: (id: string, input: HostInput) => ipcRenderer.invoke(IPC.HostsUpdate, id, input),
    exportBackup: () => ipcRenderer.invoke(IPC.HostsExport),
    importBackup: () => ipcRenderer.invoke(IPC.HostsImport)
  },

  dialog: {
    pickFile: () => ipcRenderer.invoke(IPC.DialogPickFile),
    pickFiles: () => ipcRenderer.invoke(IPC.DialogPickFiles),
    pickDirectory: () => ipcRenderer.invoke(IPC.DialogPickDirectory)
  },

  ssh: {
    connect: (sessionId: string, host: HostConfig, size: TermSize) =>
      ipcRenderer.invoke(IPC.SshConnect, sessionId, host, size),
    write: (sessionId: string, data: string) => ipcRenderer.send(IPC.SshWrite, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC.SshResize, sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.send(IPC.SshDisconnect, sessionId),
    onData: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: SessionDataEvent) =>
        // 复制为全新的 Uint8Array，避免 IPC 反序列化的底层 Buffer 视图在 xterm 解析中出现兼容问题
        cb({ sessionId: ev.sessionId, data: new Uint8Array(ev.data) })
      ipcRenderer.on(IPC.SshData, listener)
      return () => ipcRenderer.removeListener(IPC.SshData, listener)
    },
    onStatus: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: SessionStatusEvent) => cb(ev)
      ipcRenderer.on(IPC.SshStatus, listener)
      return () => ipcRenderer.removeListener(IPC.SshStatus, listener)
    }
  },

  window: {
    minimize: () => ipcRenderer.send(IPC.WindowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.WindowToggleMaximize),
    close: () => ipcRenderer.send(IPC.WindowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.WindowIsMaximized),
    onMaximizedChange: (cb) => {
      const listener = (_e: IpcRendererEvent, maximized: boolean) => cb(maximized)
      ipcRenderer.on(IPC.WindowMaximized, listener)
      return () => ipcRenderer.removeListener(IPC.WindowMaximized, listener)
    },
    openDetached: (sessionId: string, snapshot: string) =>
      ipcRenderer.send(IPC.WindowOpenDetached, sessionId, snapshot)
  },

  session: {
    attach: (sessionId: string): Promise<DetachedSessionInfo | null> =>
      ipcRenderer.invoke(IPC.SessionAttach, sessionId)
  },

  recents: {
    list: (): Promise<RecentEntry[]> => ipcRenderer.invoke(IPC.RecentsList),
    remove: (hostId: string) => ipcRenderer.invoke(IPC.RecentsRemove, hostId),
    clear: () => ipcRenderer.invoke(IPC.RecentsClear)
  },

  sshConfig: {
    list: (): Promise<SshConfigEntry[]> => ipcRenderer.invoke(IPC.SshConfigList)
  },

  sftp: {
    home: (sessionId: string): Promise<string> => ipcRenderer.invoke(IPC.SftpHome, sessionId),
    list: (sessionId: string, path: string): Promise<SftpListResult> =>
      ipcRenderer.invoke(IPC.SftpList, sessionId, path),
    mkdir: (sessionId: string, path: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SftpMkdir, sessionId, path),
    rename: (sessionId: string, oldPath: string, newPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SftpRename, sessionId, oldPath, newPath),
    remove: (sessionId: string, paths: string[]): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SftpRemove, sessionId, paths),
    upload: (sessionId: string, taskId: string, localPaths: string[], remoteDir: string) =>
      ipcRenderer.invoke(IPC.SftpUpload, sessionId, taskId, localPaths, remoteDir),
    download: (sessionId: string, taskId: string, items: DownloadItem[], conflict: ConflictPolicy) =>
      ipcRenderer.invoke(IPC.SftpDownload, sessionId, taskId, items, conflict),
    pickDownloadPath: (sessionId: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SftpPickDownload, sessionId, suggestedName),
    pickDownloadDir: (sessionId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SftpPickDownloadDir, sessionId),
    pause: (taskId: string) => ipcRenderer.send(IPC.SftpPause, taskId),
    resume: (taskId: string) => ipcRenderer.send(IPC.SftpResume, taskId),
    cancel: (taskId: string) => ipcRenderer.send(IPC.SftpCancel, taskId),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: TransferProgress) => cb(ev)
      ipcRenderer.on(IPC.SftpProgress, listener)
      return () => ipcRenderer.removeListener(IPC.SftpProgress, listener)
    }
  },

  local: {
    home: (): Promise<string> => ipcRenderer.invoke(IPC.LocalHome),
    list: (path: string): Promise<SftpListResult> => ipcRenderer.invoke(IPC.LocalList, path),
    rename: (path: string, name: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.LocalRename, path, name),
    remove: (paths: string[]): Promise<string | null> => ipcRenderer.invoke(IPC.LocalRemove, paths)
  },

  creds: {
    listKeys: () => ipcRenderer.invoke(IPC.CredsListKeys),
    generateKey: (name: string) => ipcRenderer.invoke(IPC.CredsGenerateKey, name),
    importKey: (name: string, sourcePath: string) =>
      ipcRenderer.invoke(IPC.CredsImportKey, name, sourcePath),
    replaceKey: (id: string, sourcePath: string) =>
      ipcRenderer.invoke(IPC.CredsReplaceKey, id, sourcePath),
    renameKey: (id: string, name: string) => ipcRenderer.invoke(IPC.CredsRenameKey, id, name),
    deleteKey: (id: string) => ipcRenderer.invoke(IPC.CredsDeleteKey, id),
    listPasswords: () => ipcRenderer.invoke(IPC.CredsListPasswords),
    addPassword: (label: string, password: string) =>
      ipcRenderer.invoke(IPC.CredsAddPassword, label, password),
    updatePassword: (id: string, label: string, password: string) =>
      ipcRenderer.invoke(IPC.CredsUpdatePassword, id, label, password),
    deletePassword: (id: string) => ipcRenderer.invoke(IPC.CredsDeletePassword, id)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.SettingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.SettingsSet, patch),
    onChanged: (cb) => {
      const listener = (_e: IpcRendererEvent, settings: AppSettings) => cb(settings)
      ipcRenderer.on(IPC.SettingsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.SettingsChanged, listener)
    }
  },

  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke(IPC.ClipboardWriteText, text),
    readText: () => ipcRenderer.invoke(IPC.ClipboardReadText)
  },

  utils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
