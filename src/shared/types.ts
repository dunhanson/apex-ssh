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
  status: 'success' | 'cancelled' | 'password-required' | 'preview'
  count: number
  /** 是否为包含登录凭证的加密完整备份 */
  encrypted?: boolean
  /** 加密完整备份内容统计 */
  stats?: EncryptedBackupStats
  /** 导入时新增的主机数 */
  added?: number
  /** 导入时覆盖的同 id 主机数 */
  updated?: number
  /** 导入后仍找不到对应本机凭证的引用数 */
  unresolvedCredentials?: number
  /** 导出时剔除的直填密码、私钥口令数量 */
  omittedSecrets?: number
}

export interface EncryptedBackupStats {
  hosts: number
  passwords: number
  keys: number
  passphrases: number
}

export interface BackupExportOptions {
  includeCredentials?: boolean
  /** 仅在 includeCredentials 为 true 时使用，不会持久化 */
  password?: string
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
export type TransferStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

/** 一个顶层下载项：远程路径 → 本地落点（文件为完整目标路径，目录为目标目录路径） */
export interface DownloadItem {
  remotePath: string
  localPath: string
  /** 当前顶层项目的冲突策略；未提供时使用任务默认策略 */
  conflict?: ConflictPolicy
}

/** 已存在同名目标时的实际处理策略 */
export type ConflictPolicy = 'overwrite' | 'skip' | 'rename'

/** 设置中的同名处理策略；ask 表示逐项询问 */
export type TransferConflictPolicy = 'ask' | ConflictPolicy

/** 一个顶层上传项；remoteName 用于自动重命名后的远端名称 */
export interface UploadItem {
  localPath: string
  remoteName?: string
}

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
  /** 只暴露是否存在口令，不向渲染进程返回口令内容 */
  hasPassphrase?: boolean
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
  /** 活动终端光标是否闪烁 */
  cursorBlink: boolean
  /** 回滚行数 */
  scrollback: number
  /** 用户输入时是否滚动到终端底部 */
  scrollOnInput: boolean
  /** 完成终端文本选择后是否自动复制 */
  copyOnSelect: boolean
  /** 粘贴包含换行的内容前是否要求确认 */
  confirmMultilinePaste: boolean
  /** 界面语言：跟随系统 / 中文 / English */
  language: 'system' | 'zh-CN' | 'en-US'
  /** 是否显示会话信息栏（全部窗口同步） */
  showSessionInfoBar: boolean
  /** 默认下载目录；空串表示每次询问（记住上次选择的目录） */
  downloadDir: string
  /** 下载目标存在同名项时的默认处理策略 */
  downloadConflictPolicy: TransferConflictPolicy
  /** 上传顶层项目与远端同名时的默认处理策略 */
  uploadConflictPolicy: TransferConflictPolicy
  /** SFTP 面板打开时的默认布局 */
  sftpPanelMode: 'panel' | 'split'
  /** 双栏模式左侧双击本地文件时是否直接上传 */
  doubleClickUpload: boolean
  /** 同时运行的上传与下载任务数 */
  maxConcurrentTransfers: number
  /** 传输完成后是否允许发送系统通知 */
  notifyTransferComplete: boolean
  /** 备份时是否默认包含登录凭证 */
  backupIncludeCredentials: boolean
  /** 加密备份默认使用的密码方式；只保存方式，不保存密码内容 */
  backupPasswordSource: 'custom' | 'random'
}

/**
 * 应用更新状态机：
 * idle → checking → downloading → downloaded → installing（用户确认立即安装）
 *              ↘ up-to-date          ↘ error（检查或下载失败，可重试）
 *              ↘ available（仅 checkOnly 开发环境：发现新版本但不下载）
 * unsupported：非 Windows 环境，更新能力整体不可用
 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'unsupported'

/** 更新失败分类：用于渲染端展示友好文案，原始错误不进 UI */
export type UpdateErrorCode = 'network' | 'no-release' | 'verify' | 'unknown'

/** 主 → 渲染：更新状态快照（状态广播与 getStatus 共用同一形状） */
export interface UpdateStatus {
  state: UpdateState
  /** 当前环境是否支持检查更新（Windows 安装版完整支持，Windows 开发环境仅检查） */
  supported: boolean
  /** 仅检查不下载：开发环境（未打包 Windows）为 true，不自动检查、不下载、不安装 */
  checkOnly: boolean
  /** 当前版本（app.getVersion()） */
  currentVersion: string
  /** 检测到 / 已下载的新版本号 */
  version?: string
  /** 下载进度百分比 0-100（downloading 时有效） */
  progress?: number
  /** 失败分类（error 时有效），渲染端据此选择友好文案 */
  errorCode?: UpdateErrorCode
  /** 原始错误信息，仅供诊断日志，不直接展示 */
  message?: string
}

/** 云同步连接参数（渲染端输入；password 为空表示沿用已保存的密码） */
export interface CloudSyncConnectionInput {
  host: string
  port: number
  database: string
  user: string
  /** 敏感：仅在渲染 → 主方向传递，主进程经 safeStorage 加密后持久化 */
  password?: string
}

/** 云同步连接参数的安全视图（不含密码） */
export interface CloudSyncConnectionView {
  host: string
  port: number
  database: string
  user: string
}

export interface CloudSyncGenerateKeyResult {
  /** 当前界面是否可请求主进程复制这把新密钥一次 */
  copyAvailable: boolean
  /** null 表示生成及后续云端处理成功 */
  error: string | null
}

/** 云同步失败分类：渲染端据此选择友好文案，原始错误只进主进程日志 */
export type CloudSyncErrorCode = 'connection' | 'key' | 'format' | 'unknown'

/** 一次同步的结果统计（不含任何敏感内容） */
export interface CloudSyncResult {
  /** 加密上传到云端的记录数（含删除墓碑） */
  pushed: number
  /** 从云端拉取并应用到本地的记录数 */
  pulled: number
  /** 因远端删除墓碑而删除的本地记录数 */
  deleted: number
  /** 解密 / 校验 / 写入失败而跳过的记录数 */
  skipped: number
  /** 双方同时变更（远端胜出）的记录数 */
  conflicts: number
}

/** 主 → 渲染：云同步状态快照（状态广播与 getState 共用同一形状） */
export interface CloudSyncState {
  /** 是否已保存完整的数据库连接参数 */
  configured: boolean
  enabled: boolean
  hasKey: boolean
  syncing: boolean
  /** 上次成功同步时间（ms epoch） */
  lastSyncAt?: number
  lastResult?: CloudSyncResult
  errorCode?: CloudSyncErrorCode
  /** 原始错误信息，仅供诊断，渲染端优先按 errorCode 展示 */
  message?: string
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
  HostsImportUnlock: 'hosts:import-unlock',
  HostsImportCommit: 'hosts:import-commit',
  HostsImportCancel: 'hosts:import-cancel',
  HostsBackupStats: 'hosts:backup-stats',
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
  LocalMkdir: 'local:mkdir',
  LocalOpen: 'local:open',
  LocalReveal: 'local:reveal',
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
  SettingsChanged: 'settings:changed',
  UpdaterGetStatus: 'updater:get-status',
  UpdaterCheck: 'updater:check',
  UpdaterRestartAndInstall: 'updater:restart-and-install',
  /** 主 → 渲染：更新状态变更事件，payload 为 UpdateStatus */
  UpdaterStatusChanged: 'updater:status-changed',
  CloudSyncGetState: 'cloud-sync:get-state',
  CloudSyncGetConnection: 'cloud-sync:get-connection',
  CloudSyncSaveConnection: 'cloud-sync:save-connection',
  CloudSyncTestConnection: 'cloud-sync:test-connection',
  CloudSyncGenerateKey: 'cloud-sync:generate-key',
  CloudSyncCopyGeneratedKey: 'cloud-sync:copy-generated-key',
  CloudSyncSetKey: 'cloud-sync:set-key',
  CloudSyncSetEnabled: 'cloud-sync:set-enabled',
  CloudSyncSyncNow: 'cloud-sync:sync-now',
  CloudSyncClearRemote: 'cloud-sync:clear-remote',
  /** 主 → 渲染：云同步状态变更事件，payload 为 CloudSyncState */
  CloudSyncStateChanged: 'cloud-sync:state-changed',
  /** 主 → 渲染：同步拉取应用了本地变更（应重新加载主机与凭证列表） */
  CloudSyncApplied: 'cloud-sync:applied'
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
    exportBackup: (options?: BackupExportOptions) => Promise<HostBackupResult>
    /** 从备份文件导入；在主进程确认合并或替换后执行 */
    importBackup: (options?: Pick<BackupExportOptions, 'includeCredentials'>) => Promise<HostBackupResult>
    /** 使用备份密码解锁已选择的加密备份，并返回不含明文凭证的预览 */
    unlockEncryptedBackup: (password: string) => Promise<HostBackupResult>
    /** 按预览确认后的模式提交加密备份导入 */
    commitEncryptedBackup: (mode: 'merge' | 'replace') => Promise<HostBackupResult>
    /** 取消当前待处理的加密备份并清理主进程中的明文载荷 */
    cancelEncryptedBackup: () => Promise<void>
    /** 只统计完整备份条目数量，不读取或返回凭证明文 */
    getBackupStats: () => Promise<EncryptedBackupStats>
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
      items: UploadItem[],
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
    /** 在指定本地目录中新建文件夹；返回 null 成功，否则错误信息 */
    mkdir: (path: string, name: string) => Promise<string | null>
    /** 使用系统默认程序打开本地文件或目录；返回 null 成功，否则错误信息 */
    open: (path: string) => Promise<string | null>
    /** 在系统文件管理器中显示本地项目；返回 null 成功，否则错误信息 */
    reveal: (path: string) => Promise<string | null>
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
  updater: {
    /** 当前更新状态快照；不支持的环境返回 state = unsupported */
    getStatus: () => Promise<UpdateStatus>
    /** 手动检查更新；检查/下载进行中时直接返回当前状态 */
    check: () => Promise<UpdateStatus>
    /** 已下载后立即静默安装并重启；仅 downloaded 状态有效，其他状态为空操作 */
    restartAndInstall: () => Promise<void>
    /** 订阅更新状态变更，返回取消订阅函数 */
    onStatusChanged: (cb: (status: UpdateStatus) => void) => () => void
  }
  cloudSync: {
    /** 当前云同步状态快照 */
    getState: () => Promise<CloudSyncState>
    /** 已保存的连接参数（不含密码）；未配置返回 null */
    getConnection: () => Promise<CloudSyncConnectionView | null>
    /** 保存连接参数；返回 null 成功，否则错误信息。password 为空沿用已保存密码 */
    saveConnection: (input: CloudSyncConnectionInput) => Promise<string | null>
    /** 用给定参数试连并初始化表结构；不落盘，返回 null 成功 */
    testConnection: (input: CloudSyncConnectionInput) => Promise<string | null>
    /** 生成新的 24 位随机同步密钥并持久化；已启用时会清空云端并全量重写 */
    generateKey: () => Promise<CloudSyncGenerateKeyResult>
    /** 用户主动复制刚生成的同步密钥；成功后同一密钥不可再次复制 */
    copyGeneratedKey: () => Promise<boolean>
    /** 填入其他设备已在使用的同步密钥；云端有数据时先校验可解密 */
    setKey: (key: string) => Promise<string | null>
    /** 启用 / 停用云同步；启用时立即执行一次同步 */
    setEnabled: (enabled: boolean) => Promise<string | null>
    /** 立即同步；返回 null 成功，否则错误信息 */
    syncNow: () => Promise<string | null>
    /** 清空云端全部同步记录（保留表结构） */
    clearRemote: () => Promise<string | null>
    /** 订阅云同步状态变更，返回取消订阅函数 */
    onStateChanged: (cb: (state: CloudSyncState) => void) => () => void
    /** 订阅同步应用本地变更事件（重新加载主机与凭证列表） */
    onApplied: (cb: () => void) => () => void
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
