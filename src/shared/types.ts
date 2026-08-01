/**
 * 主进程 / 预加载 / 渲染进程三端共享的类型与 IPC 通道常量。
 * 改动本文件时需同步检查 preload 的桥接实现与渲染进程的 window.api 声明。
 */

/** 主机认证方式：密码或私钥文件；可直接给值，也可引用凭证库条目（M4） */
export type AuthConfig =
  | { type: 'password'; password?: string; passwordId?: string }
  | { type: 'key'; privateKeyPath?: string; keyId?: string; passphrase?: string }

/** 主机配置（M1：密码/密钥随主机直接保存；safeStorage 加密与凭证库属 M4） */
export interface HostConfig {
  id: string
  label: string
  description?: string
  host: string
  port: number
  username: string
  group?: string
  auth: AuthConfig
}

/** 新建主机时的入参（id 由主进程生成） */
export type HostInput = Omit<HostConfig, 'id'>

/** 主机配置备份导入结果；凭证本体不属于备份范围 */
export interface HostBackupResult {
  status: 'success' | 'cancelled'
  count: number
  /** 导入时新增的主机数 */
  added?: number
  /** 导入时覆盖的同 id 主机数 */
  updated?: number
  /** 导入后仍找不到对应本机凭证的引用数 */
  unresolvedCredentials?: number
  /** 导出时剔除的直填密码、私钥口令数量 */
  omittedSecrets?: number
}

/** 会话状态机 */
export type SessionStatus = 'connecting' | 'connected' | 'error' | 'closed'

/** 主 → 渲染：会话状态变更事件 */
export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  /** status 为 error 时带上的错误信息 */
  message?: string
}

/** 主 → 渲染：终端输出数据事件（data 经 IPC 抵达渲染端为 Uint8Array） */
export interface SessionDataEvent {
  sessionId: string
  data: Uint8Array
}

/** 终端初始尺寸 */
export interface TermSize {
  cols: number
  rows: number
}

/** 最近使用记录（按连接时间倒序，最多保留 50 条） */
export interface RecentEntry {
  hostId: string
  label: string
  host: string
  port: number
  username: string
  /** 最近一次连接成功的时间（ms epoch） */
  connectedAt: number
}

/** ~/.ssh/config 解析出的单台主机条目（Host * 通配块只作默认值合并，不生成条目） */
export interface SshConfigEntry {
  /** Host 别名，导入时作为 Label */
  alias: string
  hostname?: string
  user?: string
  port?: number
  identityFile?: string
  /** 含 ProxyJump / ProxyCommand（暂不支持，导入时标 ⚠） */
  hasProxy: boolean
}

/** 会话迁出到新窗口时携带的信息（含终端快照，保证历史不丢） */
export interface DetachedSessionInfo {
  sessionId: string
  host: HostConfig
  /** xterm serialize 快照（含回滚），新窗口先写入快照再接续实时数据 */
  snapshot: string
}

/** SFTP / 本地文件条目（双栏式本地侧复用同一形状） */
export interface SftpEntry {
  name: string
  /** 完整路径 */
  path: string
  type: 'file' | 'dir' | 'link' | 'other'
  size: number
  /** 修改时间（s epoch） */
  mtime: number
  /** 权限字符串，如 rwxr-xr-x（本地侧简化处理） */
  permissions: string
}

/** 目录列表结果；目录不可读（如权限不足）时 error 带原因、entries 为空 */
export interface SftpListResult {
  path: string
  entries: SftpEntry[]
  error?: string
}

/** 传输任务状态机 */
export type TransferStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled'

/** 一个顶层下载项：远程路径 → 本地落点（文件为完整目标路径，目录为目标目录路径） */
export interface DownloadItem {
  remotePath: string
  localPath: string
}

/** 本地已存在同名目标时的处理策略（对整个任务生效） */
export type ConflictPolicy = 'overwrite' | 'skip' | 'rename'

/** 主 → 渲染：传输进度事件 */
export interface TransferProgress {
  sessionId: string
  taskId: string
  transferred: number
  total: number
  status: TransferStatus
  /** status 为 error 时的信息 */
  message?: string
}

/** 密钥库条目元数据（私钥本体落盘 userData/keys/，不回传渲染端） */
export interface KeyEntry {
  id: string
  name: string
  /** SHA256 指纹（ssh-keygen -lf 输出） */
  fingerprint: string
  /** 公钥内容（OpenSSH 单行） */
  publicKey: string
  createdAt: number
}

/** 密码库条目元数据（密文经 safeStorage 加密落盘，元数据不含明文） */
export interface PasswordMeta {
  id: string
  label: string
  createdAt: number
}

/** 终端与界面设置（设置工作区） */
export interface AppSettings {
  /** 终端字号 px */
  fontSize: number
  cursorStyle: 'block' | 'underline' | 'bar'
  /** 回滚行数 */
  scrollback: number
  /** 界面语言：跟随系统 / 中文 / English */
  language: 'system' | 'zh-CN' | 'en-US'
  /** 是否显示会话信息栏（全部窗口同步） */
  showSessionInfoBar: boolean
  /** 默认下载目录；空串表示每次询问（记住上次选择的目录） */
  downloadDir: string
}

/** IPC 通道名常量，避免三端各自硬编码 */
export const IPC = {
  Ping: 'app:ping',
  HostsList: 'hosts:list',
  HostsAdd: 'hosts:add',
  HostsDelete: 'hosts:delete',
  HostsUpdate: 'hosts:update',
  HostsExport: 'hosts:export',
  HostsImport: 'hosts:import',
  ClipboardWriteText: 'clipboard:write-text',
  ClipboardReadText: 'clipboard:read-text',
  DialogPickFile: 'dialog:pick-file',
  DialogPickFiles: 'dialog:pick-files',
  DialogPickDirectory: 'dialog:pick-directory',
  SshConnect: 'ssh:connect',
  SshWrite: 'ssh:write',
  SshResize: 'ssh:resize',
  SshDisconnect: 'ssh:disconnect',
  SshData: 'ssh:data',
  SshStatus: 'ssh:status',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:is-maximized',
  /** 主 → 渲染：最大化状态变更事件，payload 为 boolean */
  WindowMaximized: 'window:maximized',
  /** 渲染 → 主：把会话迁出为独立窗口（携带终端快照） */
  WindowOpenDetached: 'window:open-detached',
  /** 新窗口 → 主：接管被迁出会话的数据流，返回会话信息 + 快照 */
  SessionAttach: 'session:attach',
  RecentsList: 'recents:list',
  RecentsRemove: 'recents:remove',
  RecentsClear: 'recents:clear',
  SshConfigList: 'sshconfig:list',
  SftpHome: 'sftp:home',
  SftpList: 'sftp:list',
  SftpMkdir: 'sftp:mkdir',
  SftpUpload: 'sftp:upload',
  SftpDownload: 'sftp:download',
  SftpPickDownload: 'sftp:pick-download',
  SftpPickDownloadDir: 'sftp:pick-download-dir',
  SftpRename: 'sftp:rename',
  SftpRemove: 'sftp:remove',
  SftpPause: 'sftp:pause',
  SftpResume: 'sftp:resume',
  SftpCancel: 'sftp:cancel',
  /** 主 → 渲染：传输进度事件，payload 为 TransferProgress */
  SftpProgress: 'sftp:progress',
  LocalHome: 'local:home',
  LocalList: 'local:list',
  LocalRename: 'local:rename',
  LocalRemove: 'local:remove',
  CredsListKeys: 'creds:list-keys',
  CredsGenerateKey: 'creds:generate-key',
  CredsImportKey: 'creds:import-key',
  CredsReplaceKey: 'creds:replace-key',
  CredsRenameKey: 'creds:rename-key',
  CredsDeleteKey: 'creds:delete-key',
  CredsListPasswords: 'creds:list-passwords',
  CredsAddPassword: 'creds:add-password',
  CredsUpdatePassword: 'creds:update-password',
  CredsDeletePassword: 'creds:delete-password',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  /** 主 → 渲染：设置变更事件，payload 为 AppSettings */
  SettingsChanged: 'settings:changed'
} as const

/** 预加载桥暴露给渲染进程的 window.api 形状 */
export interface RendererApi {
  ping: () => Promise<string>
  hosts: {
    list: () => Promise<HostConfig[]>
    add: (input: HostInput) => Promise<HostConfig>
    delete: (id: string) => Promise<void>
    update: (id: string, input: HostInput) => Promise<HostConfig>
    /** 导出主机配置；不包含直填密码、私钥内容或私钥口令 */
    exportBackup: () => Promise<HostBackupResult>
    /** 从备份文件导入；在主进程确认合并或替换后执行 */
    importBackup: () => Promise<HostBackupResult>
  }
  dialog: {
    /** 打开文件选择框（选私钥等），取消时返回 null */
    pickFile: () => Promise<string | null>
    /** 多选文件（SFTP 上传），取消返回空数组 */
    pickFiles: () => Promise<string[]>
    /** 选择文件夹（SFTP 上传目录），取消返回 null */
    pickDirectory: () => Promise<string | null>
  }
  ssh: {
    /** sessionId 由渲染端生成并传入，便于标签页在连接返回前就有稳定 id */
    connect: (sessionId: string, host: HostConfig, size: TermSize) => Promise<void>
    write: (sessionId: string, data: string) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    disconnect: (sessionId: string) => void
    /** 订阅终端输出，返回取消订阅函数 */
    onData: (cb: (ev: SessionDataEvent) => void) => () => void
    /** 订阅会话状态变更，返回取消订阅函数 */
    onStatus: (cb: (ev: SessionStatusEvent) => void) => () => void
  }
  window: {
    minimize: () => void
    /** 最大化 / 还原切换 */
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    /** 订阅最大化状态变更，返回取消订阅函数 */
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
    /** 把会话迁出为独立窗口（通道不断开，snapshot 为终端快照） */
    openDetached: (sessionId: string, snapshot: string) => void
  }
  session: {
    /** 独立窗口启动时调用：接管会话数据流并拿到会话信息与终端快照；会话不存在时返回 null */
    attach: (sessionId: string) => Promise<DetachedSessionInfo | null>
  }
  recents: {
    list: () => Promise<RecentEntry[]>
    remove: (hostId: string) => Promise<void>
    clear: () => Promise<void>
  }
  sshConfig: {
    /** 解析 ~/.ssh/config 的主机条目；文件不存在时返回空数组 */
    list: () => Promise<SshConfigEntry[]>
  }
  sftp: {
    /** 远端 Shell 当前工作目录；查询失败时回退到登录目录 */
    home: (sessionId: string) => Promise<string>
    list: (sessionId: string, path: string) => Promise<SftpListResult>
    /** 新建文件夹；返回 null 成功，否则错误信息 */
    mkdir: (sessionId: string, path: string) => Promise<string | null>
    /** 重命名 / 移动远程文件或目录；返回 null 成功，否则错误信息 */
    rename: (sessionId: string, oldPath: string, newPath: string) => Promise<string | null>
    /** 递归删除远程文件 / 目录；返回 null 成功，否则错误信息 */
    remove: (sessionId: string, paths: string[]) => Promise<string | null>
    /** 上传本地文件/文件夹（含嵌套）到远端目录，返回总字节数或错误 */
    upload: (
      sessionId: string,
      taskId: string,
      localPaths: string[],
      remoteDir: string
    ) => Promise<{ total: number } | { error: string }>
    /** 批量下载远程文件/目录（含嵌套）到本地，返回总字节数或错误 */
    download: (
      sessionId: string,
      taskId: string,
      items: DownloadItem[],
      conflict: ConflictPolicy
    ) => Promise<{ total: number } | { error: string }>
    /** 弹保存对话框选单文件下载位置，取消返回 null */
    pickDownloadPath: (sessionId: string, suggestedName: string) => Promise<string | null>
    /** 弹目录选择框选批量下载目录，取消返回 null */
    pickDownloadDir: (sessionId: string) => Promise<string | null>
    pause: (taskId: string) => void
    resume: (taskId: string) => void
    cancel: (taskId: string) => void
    /** 订阅传输进度，返回取消订阅函数 */
    onProgress: (cb: (ev: TransferProgress) => void) => () => void
  }
  local: {
    home: () => Promise<string>
    list: (path: string) => Promise<SftpListResult>
    rename: (path: string, name: string) => Promise<string | null>
    remove: (paths: string[]) => Promise<string | null>
  }
  creds: {
    listKeys: () => Promise<KeyEntry[]>
    /** 生成 Ed25519 密钥对（调用系统 ssh-keygen），成功返回条目，失败返回错误信息 */
    generateKey: (name: string) => Promise<{ entry: KeyEntry } | { error: string }>
    /** 导入本地私钥（复制进密钥库并派生公钥/指纹） */
    importKey: (name: string, sourcePath: string) => Promise<{ entry: KeyEntry } | { error: string }>
    /** 替换私钥内容并更新公钥/指纹，保留条目 ID 和显示名称 */
    replaceKey: (id: string, sourcePath: string) => Promise<{ entry: KeyEntry } | { error: string }>
    /** 仅修改密钥显示名称，不影响文件和引用 ID */
    renameKey: (id: string, name: string) => Promise<string | null>
    /** 删除密钥；被主机引用时返回错误（含引用主机名） */
    deleteKey: (id: string) => Promise<string | null>
    listPasswords: () => Promise<PasswordMeta[]>
    /** 密码经 safeStorage 加密落盘 */
    addPassword: (label: string, password: string) => Promise<PasswordMeta>
    /** 修改密码备注；password 为空时保留原密文，否则重新加密替换 */
    updatePassword: (id: string, label: string, password: string) => Promise<string | null>
    /** 删除密码；被主机引用时返回错误（含引用主机名） */
    deletePassword: (id: string) => Promise<string | null>
  }
  settings: {
    get: () => Promise<AppSettings>
    /** 部分更新并广播 SettingsChanged */
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>
    onChanged: (cb: (settings: AppSettings) => void) => () => void
  }
  clipboard: {
    /** 通过 Electron 主进程写入系统剪贴板，避免 Chromium 权限差异 */
    writeText: (text: string) => Promise<boolean>
    /** 通过 Electron 主进程读取系统剪贴板，用于终端粘贴 */
    readText: () => Promise<string>
  }
  utils: {
    /** 拖拽文件 → 本地绝对路径（Electron 32+ File.path 已移除，走 webUtils） */
    getPathForFile: (file: File) => string
  }
}
