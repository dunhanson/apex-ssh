import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  FileText,
  Folder,
  FolderPlus,
  Link2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  Upload,
  X
} from 'lucide-react'
import type { ConflictPolicy, DownloadItem, SftpEntry, SftpListResult } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getSettingsSnapshot } from '@/lib/settings'
import { addTransfer, clearCompleted, getTransfer, removeTransfer, useTransfers, type TransferItem } from '@/lib/transfers'

/**
 * SFTP 面板：挂在终端下方。
 * 面板式（远程目录导航 / 筛选 / 新建文件夹 / 上传）与双栏式（左本地右远程 + 箭头互传）一键切换；
 * 面板高度 120px–视口 80% 可拖拽；本地文件拖入远程区即上传（含嵌套目录）；底部为统一传输队列。
 * 远程列表为标准多选（单击选中 / Ctrl 切换 / Shift 范围），双击目录进入、双击文件下载；
 * 右键菜单提供下载（到默认目录）/ 下载到… / 重命名 / 删除 / 复制路径，批量下载合并为单任务，
 * 本地同名冲突弹窗选择覆盖 / 跳过 / 自动重命名（对整个任务生效）。
 */
interface SftpPanelProps {
  sessionId: string
  onClose: () => void
}

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const fmtTime = (s: number): string =>
  new Date(s * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

const joinRemote = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)
/** 本地路径拼接：node fs 在 Windows 上同时接受两种分隔符，统一用 / 即可 */
const joinLocal = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, '')}/${name}`
const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

function EntryIcon({ type }: { type: SftpEntry['type'] }) {
  if (type === 'dir') return <Folder className="size-3.5 text-dim shrink-0" strokeWidth={1.5} />
  if (type === 'link') return <Link2 className="size-3.5 text-faint shrink-0" strokeWidth={1.5} />
  return <FileText className="size-3.5 text-faint shrink-0" strokeWidth={1.5} />
}

export function SftpPanel({ sessionId, onClose }: SftpPanelProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'panel' | 'split'>('panel')
  const [height, setHeight] = useState(240)
  const [remotePath, setRemotePath] = useState<string | null>(null)
  const [remote, setRemote] = useState<SftpListResult | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // 双栏式：本地侧状态与两侧选中集
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [localPathInput, setLocalPathInput] = useState('')
  const [local, setLocal] = useState<SftpListResult | null>(null)
  const [localRenaming, setLocalRenaming] = useState<string | null>(null)
  const [selLocal, setSelLocal] = useState<Set<string>>(new Set())
  const [selRemote, setSelRemote] = useState<Set<string>>(new Set())
  // 右键菜单目标（null = 空白区菜单）
  const [menuEntry, setMenuEntry] = useState<SftpEntry | null>(null)
  const [localMenuEntry, setLocalMenuEntry] = useState<SftpEntry | null>(null)
  // 冲突策略询问与删除确认（Promise 化，挂起下载流程等待用户选择）
  const [conflictAsk, setConflictAsk] = useState<{
    names: string[]
    resolve: (policy: ConflictPolicy | null) => void
  } | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<SftpEntry[] | null>(null)
  const [localDeleteAsk, setLocalDeleteAsk] = useState<SftpEntry[] | null>(null)
  const transfers = useTransfers(sessionId)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<string | null>(null)
  const localAnchorRef = useRef<string | null>(null)
  const rowTargetRef = useRef<SftpEntry | null>(null)
  const localRowTargetRef = useRef<SftpEntry | null>(null)

  useEffect(() => {
    const clearSelectionOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelLocal(new Set())
      setSelRemote(new Set())
      anchorRef.current = null
      localAnchorRef.current = null
    }
    window.addEventListener('keydown', clearSelectionOnEscape)
    return () => window.removeEventListener('keydown', clearSelectionOnEscape)
  }, [])

  const refreshRemote = useCallback(
    async (path: string) => {
      const result = await window.api.sftp.list(sessionId, path)
      setRemote(result)
      setSelRemote(new Set())
      anchorRef.current = null
      if (!result.error) {
        setRemotePath(result.path)
        setPathInput(result.path)
      } else {
        setRemote({ ...result, path })
      }
    },
    [sessionId]
  )

  const refreshLocal = useCallback(async (path: string) => {
    const result = await window.api.local.list(path)
    setLocal(result)
    setSelLocal(new Set())
    localAnchorRef.current = null
    if (!result.error) {
      setLocalPath(result.path)
      setLocalPathInput(result.path)
    }
  }, [])

  // 打开面板：定位到当前 Shell 的工作目录（查询失败时主进程回退到远端 home）
  useEffect(() => {
    window.api.sftp
      .home(sessionId)
      .then((home) => refreshRemote(home))
      .catch((err) => toast.error(t('sftp.initFailed', { message: err instanceof Error ? err.message : String(err) })))
  }, [sessionId, refreshRemote])

  // 切到双栏式：定位到本地 home
  useEffect(() => {
    if (mode === 'split' && localPath === null) {
      window.api.local.home().then(refreshLocal)
    }
  }, [mode, localPath, refreshLocal])

  const filtered = useMemo(() => {
    if (!remote) return []
    const kw = filter.trim().toLowerCase()
    return kw ? remote.entries.filter((e) => e.name.toLowerCase().includes(kw)) : remote.entries
  }, [remote, filter])

  /** 轮询任务终态后回调（传输完成后目标目录才需要刷新） */
  const watchTaskDone = useCallback((taskId: string, cb: () => void) => {
    const timer = setInterval(() => {
      const task = getTransfer(taskId)
      if (!task || (task.status !== 'running' && task.status !== 'paused')) {
        clearInterval(timer)
        cb()
      }
    }, 500)
  }, [])

  /** 发起上传任务（统一入口：按钮选择 / 拖拽 / 双栏箭头） */
  const startUpload = useCallback(
    async (localPaths: string[]) => {
      if (localPaths.length === 0 || !remotePath) return
      const taskId = crypto.randomUUID()
      const name =
        localPaths.length === 1
          ? (localPaths[0].split(/[\\/]/).pop() ?? localPaths[0])
          : t('sftp.items', { count: localPaths.length })
      addTransfer({ taskId, sessionId, direction: 'up', name, total: 0 })
      const result = await window.api.sftp.upload(sessionId, taskId, localPaths, remotePath)
      if ('error' in result) {
        toast.error(t('sftp.uploadFailed', { message: result.error }))
        removeTransfer(taskId)
        return
      }
      // 传输完成后文件才出现在目标目录：轮询任务终态后刷新
      watchTaskDone(taskId, () => remotePath && refreshRemote(remotePath))
    },
    [sessionId, remotePath, refreshRemote, watchTaskDone]
  )

  /** 发起批量下载任务（统一入口：快速下载 / 下载到… / 双栏箭头） */
  const startDownloadTask = useCallback(
    async (items: DownloadItem[], conflict: ConflictPolicy, onDone?: () => void) => {
      if (items.length === 0) return
      const taskId = crypto.randomUUID()
      const name =
        items.length === 1
          ? (items[0].remotePath.split('/').pop() ?? items[0].remotePath)
          : t('sftp.items', { count: items.length })
      addTransfer({ taskId, sessionId, direction: 'down', name, total: 0 })
      const result = await window.api.sftp.download(sessionId, taskId, items, conflict)
      if ('error' in result) {
        toast.error(t('sftp.downloadFailed', { message: result.error }))
        removeTransfer(taskId)
        return
      }
      if (onDone) watchTaskDone(taskId, onDone)
    },
    [sessionId, watchTaskDone]
  )

  /** 冲突询问：本地目标目录已有同名项时弹窗，返回 null 表示用户取消 */
  const askConflict = useCallback(
    (names: string[]) =>
      new Promise<ConflictPolicy | null>((resolve) => {
        setConflictAsk({ names, resolve })
      }),
    []
  )

  /** 把远程条目下载到本地目录：先查同名冲突，必要时询问策略 */
  const downloadToDir = useCallback(
    async (entries: SftpEntry[], targetDir: string, onDone?: () => void) => {
      const items: DownloadItem[] = entries.map((e) => ({
        remotePath: e.path,
        localPath: joinLocal(targetDir, e.name)
      }))
      let policy: ConflictPolicy = 'overwrite'
      const listing = await window.api.local.list(targetDir)
      if (!listing.error) {
        const existing = new Set(listing.entries.map((e) => e.name))
        const conflicts = entries.filter((e) => existing.has(e.name)).map((e) => e.name)
        if (conflicts.length > 0) {
          const chosen = await askConflict(conflicts)
          if (!chosen) return
          policy = chosen
        }
      }
      await startDownloadTask(items, policy, onDone)
    },
    [askConflict, startDownloadTask]
  )

  /** 快速下载：落到设置的默认下载目录；未设置时弹目录选择框（主进程记住上次位置） */
  const quickDownload = useCallback(
    async (entries: SftpEntry[], onDone?: () => void) => {
      let dir = getSettingsSnapshot().downloadDir
      if (!dir) {
        dir = (await window.api.sftp.pickDownloadDir(sessionId)) ?? ''
        if (!dir) return
      }
      await downloadToDir(entries, dir, onDone)
    },
    [sessionId, downloadToDir]
  )

  /** 下载到…：单文件弹保存对话框（可改名）；多选 / 含目录弹目录选择框 */
  const downloadTo = useCallback(
    async (entries: SftpEntry[]) => {
      const single = entries.length === 1 ? entries[0] : null
      if (single && single.type === 'file') {
        const target = await window.api.sftp.pickDownloadPath(sessionId, single.name)
        if (!target) return
        await startDownloadTask([{ remotePath: single.path, localPath: target }], 'overwrite')
        return
      }
      const dir = await window.api.sftp.pickDownloadDir(sessionId)
      if (!dir) return
      await downloadToDir(entries, dir)
    },
    [sessionId, startDownloadTask, downloadToDir]
  )

  /** 新建文件夹：内联输入行确认 */
  const submitNewFolder = async (name: string) => {
    setCreating(false)
    const trimmed = name.trim()
    if (!trimmed || !remotePath) return
    const err = await window.api.sftp.mkdir(sessionId, joinRemote(remotePath, trimmed))
    if (err) toast.error(t('sftp.mkdirFailed', { message: err }))
    else refreshRemote(remotePath)
  }

  /** 重命名：内联输入行确认 */
  const submitRename = async (entry: SftpEntry, name: string) => {
    setRenaming(null)
    const trimmed = name.trim()
    if (!trimmed || trimmed === entry.name || !remotePath) return
    const err = await window.api.sftp.rename(sessionId, entry.path, joinRemote(remotePath, trimmed))
    if (err) toast.error(t('sftp.renameFailed', { message: err }))
    else refreshRemote(remotePath)
  }

  const submitLocalRename = async (entry: SftpEntry, name: string) => {
    setLocalRenaming(null)
    const trimmed = name.trim()
    if (!trimmed || trimmed === entry.name || !localPath) return
    const err = await window.api.local.rename(entry.path, trimmed)
    if (err) toast.error(t('sftp.renameFailed', { message: err }))
    else refreshLocal(localPath)
  }

  /** 删除确认后执行 */
  const confirmDelete = async () => {
    const entries = deleteAsk
    setDeleteAsk(null)
    if (!entries || entries.length === 0 || !remotePath) return
    const err = await window.api.sftp.remove(sessionId, entries.map((e) => e.path))
    if (err) toast.error(t('sftp.deleteFailed', { message: err }))
    refreshRemote(remotePath)
  }

  const confirmLocalDelete = async () => {
    const entries = localDeleteAsk
    setLocalDeleteAsk(null)
    if (!entries || entries.length === 0 || !localPath) return
    const err = await window.api.local.remove(entries.map((entry) => entry.path))
    if (err) toast.error(t('sftp.deleteFailed', { message: err }))
    refreshLocal(localPath)
  }

  /** 拖拽上传 */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const paths = [...e.dataTransfer.files]
      .map((f) => window.api.utils.getPathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) startUpload(paths)
  }

  /** 面板高度拖拽：120px–视口 80%，拖动中终端实时重排（flex 布局自动） */
  const startHeightDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const onMove = (ev: MouseEvent) => {
      const next = startHeight + (startY - ev.clientY)
      setHeight(Math.min(window.innerHeight * 0.8, Math.max(120, next)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const toggleSel = (set: Set<string>, path: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setter(next)
  }

  /** 远程列表标准多选：单击单选 / Ctrl 切换 / Shift 范围（锚点为上次单击项） */
  const handleSelect = (entry: SftpEntry, e: React.MouseEvent) => {
    if (e.shiftKey && anchorRef.current) {
      const paths = filtered.map((f) => f.path)
      const a = paths.indexOf(anchorRef.current)
      const b = paths.indexOf(entry.path)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelRemote(new Set(paths.slice(lo, hi + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSel(selRemote, entry.path, setSelRemote)
    } else {
      setSelRemote(new Set([entry.path]))
    }
    anchorRef.current = entry.path
  }

  /** 双栏本地列表与远程列表保持一致：单击单选 / Ctrl 切换 / Shift 范围 */
  const handleLocalSelect = (entry: SftpEntry, e: React.MouseEvent) => {
    const paths = (local?.entries ?? []).map((item) => item.path)
    if (e.shiftKey && localAnchorRef.current) {
      const a = paths.indexOf(localAnchorRef.current)
      const b = paths.indexOf(entry.path)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelLocal(new Set(paths.slice(lo, hi + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSel(selLocal, entry.path, setSelLocal)
    } else {
      setSelLocal(new Set([entry.path]))
    }
    localAnchorRef.current = entry.path
  }

  const handleLocalRowContextMenu = (entry: SftpEntry) => {
    localRowTargetRef.current = entry
    if (!selLocal.has(entry.path)) {
      setSelLocal(new Set([entry.path]))
      localAnchorRef.current = entry.path
    }
  }

  const uploadSelectedLocal = () => {
    startUpload([...selLocal])
    setSelLocal(new Set())
    localAnchorRef.current = null
  }

  /** 双击：目录进入，文件快速下载 */
  const handleEntryDoubleClick = (entry: SftpEntry) => {
    if (entry.type === 'dir') {
      setFilter('')
      refreshRemote(entry.path)
    } else if (entry.type === 'file') {
      quickDownload([entry])
    }
  }

  /** 右键行：未选中则改为单选它；记录目标供列表级菜单读取 */
  const handleRowContextMenu = (entry: SftpEntry) => {
    rowTargetRef.current = entry
    if (!selRemote.has(entry.path)) {
      setSelRemote(new Set([entry.path]))
      anchorRef.current = entry.path
    }
  }

  /** 右键菜单动作对象：右击行时作用于选中集，右击空白时为 null */
  const selectedLocalEntries = (): SftpEntry[] =>
    (local?.entries ?? []).filter((entry) => selLocal.has(entry.path))

  const selectedRemoteEntries = (): SftpEntry[] =>
    (remote?.entries ?? []).filter((e) => selRemote.has(e.path))

  const renderEntryRow = (
    entry: SftpEntry,
    opts: {
      selected?: boolean
      renaming?: boolean
      onClick: (e: React.MouseEvent) => void
      onDoubleClick?: () => void
      onContextMenu?: () => void
      onRenameSubmit?: (name: string) => void
      onRenameCancel?: () => void
    }
  ) => (
    <div
      key={entry.path}
      className={cn(
        'flex items-center gap-2 px-3 py-[5px] cursor-pointer font-mono text-[11px] transition-colors duration-75',
        opts.selected ? 'bg-white/[0.07] text-fg' : 'text-dim hover:bg-white/[0.03]'
      )}
      onClick={opts.onClick}
      onDoubleClick={opts.onDoubleClick}
      onContextMenu={opts.onContextMenu}
      title={entry.path}
    >
      <EntryIcon type={entry.type} />
      {opts.renaming ? (
        <input
          autoFocus
          className="flex-1 min-w-0 bg-elevated border border-line-strong rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none"
          defaultValue={entry.name}
          placeholder={t('sftp.renamePlaceholder')}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') opts.onRenameSubmit?.(e.currentTarget.value)
            if (e.key === 'Escape') opts.onRenameCancel?.()
          }}
          onBlur={opts.onRenameCancel}
        />
      ) : (
        <span className="flex-1 min-w-0 truncate">{entry.name}</span>
      )}
      <span className="w-[72px] text-right text-faint shrink-0">
        {entry.type === 'dir' ? '' : fmtSize(entry.size)}
      </span>
      <span className="w-[92px] text-right text-ghost shrink-0">{fmtTime(entry.mtime)}</span>
    </div>
  )

  /** 远程列表：两种模式共用；容器挂列表级右键菜单（行内右键先记录目标） */
  const renderRemoteList = () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto py-1"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return
            setSelRemote(new Set())
            anchorRef.current = null
          }}
          onContextMenu={() => {
            setMenuEntry(rowTargetRef.current)
            rowTargetRef.current = null
          }}
        >
          {remote?.error ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-danger">
              {remote.error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-ghost">
              {remote ? t('sftp.emptyDir') : t('sftp.loading')}
            </div>
          ) : (
            filtered.map((entry) =>
              renderEntryRow(entry, {
                selected: selRemote.has(entry.path),
                renaming: renaming === entry.path,
                onClick: (e) => handleSelect(entry, e),
                onDoubleClick: () => handleEntryDoubleClick(entry),
                onContextMenu: () => handleRowContextMenu(entry),
                onRenameSubmit: (name) => submitRename(entry, name),
                onRenameCancel: () => setRenaming(null)
              })
            )
          )}
          {creating && (
            <div className="flex items-center gap-2 px-3 py-[4px]">
              <Folder className="size-3.5 text-dim shrink-0" strokeWidth={1.5} />
              <input
                autoFocus
                className="flex-1 bg-elevated border border-line-strong rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none"
                placeholder={t('sftp.newFolderPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewFolder(e.currentTarget.value)
                  if (e.key === 'Escape') setCreating(false)
                }}
                onBlur={() => setCreating(false)}
              />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuEntry ? (
          <>
            <ContextMenuItem onSelect={() => quickDownload(selectedRemoteEntries())}>
              {t('sftp.menuDownload')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => downloadTo(selectedRemoteEntries())}>
              {t('sftp.menuDownloadTo')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={selRemote.size !== 1}
              onSelect={() => menuEntry && setRenaming(menuEntry.path)}
            >
              {t('sftp.menuRename')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setDeleteAsk(selectedRemoteEntries())}>
              {t('sftp.menuDelete')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                navigator.clipboard.writeText(selectedRemoteEntries().map((e) => e.path).join('\n'))
                toast.success(t('sftp.pathCopied'))
              }}
            >
              {t('sftp.menuCopyPath')}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => remotePath && refreshRemote(remotePath)}>
              {t('sftp.refresh')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setCreating(true)}>
              {t('sftp.newFolder')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={async () => startUpload(await window.api.dialog.pickFiles())}>
              {t('sftp.uploadFile')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={async () => {
                const dir = await window.api.dialog.pickDirectory()
                if (dir) startUpload([dir])
              }}
            >
              {t('sftp.uploadFolder')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )

  const submitSplitPath = (side: 'local' | 'remote', value: string): void => {
    const path = value.trim()
    if (!path) return
    if (side === 'local') refreshLocal(path)
    else refreshRemote(path)
  }

  const renderSplitPath = (side: 'local' | 'remote') => {
    const value = side === 'local' ? localPathInput : pathInput
    return (
      <input
        className="flex-1 min-w-0 bg-elevated border border-line rounded-sm px-2 py-[3px] font-mono text-[11px] text-fg outline-none focus:border-white/20"
        value={value}
        aria-label={t(side === 'local' ? 'sftp.localPath' : 'sftp.remotePath')}
        spellCheck={false}
        onChange={(e) => {
          if (side === 'local') setLocalPathInput(e.target.value)
          else setPathInput(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitSplitPath(side, e.currentTarget.value)
          if (e.key === 'Escape') {
            if (side === 'local') setLocalPathInput(localPath ?? '')
            else setPathInput(remotePath ?? '')
          }
        }}
      />
    )
  }

  return (
    <div className="shrink-0 flex flex-col border-t border-white/[0.06] bg-panel" style={{ height }}>
      {/* 高度拖拽条 */}
      <div
        className="h-[5px] -mt-[3px] shrink-0 cursor-row-resize relative z-10 hover:bg-white/[0.08] transition-colors"
        onMouseDown={startHeightDrag}
        title={t('sftp.dragHeight')}
      />

      {/* 工具栏 */}
      <div className="h-9 shrink-0 flex items-center gap-1.5 px-2.5 border-b border-white/[0.06]">
        {mode === 'panel' ? (
          <>
            <button className="icon-btn" title={t('sftp.upLevel')} onClick={() => remotePath && refreshRemote(parentOf(remotePath))}>
              <ArrowUp className="size-3.5" />
            </button>
            <input
              className="flex-1 min-w-0 bg-elevated border border-line rounded-sm px-2 py-[3px] font-mono text-[11px] text-fg outline-none focus:border-white/20"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refreshRemote(pathInput.trim() || '/')}
              spellCheck={false}
            />
            <div className="flex items-center gap-1 bg-elevated border border-line rounded-sm px-2 py-[3px]">
              <Search className="size-3 text-ghost shrink-0" />
              <input
                className="bg-transparent border-none outline-none font-mono text-[11px] text-fg w-20 placeholder:text-[#2e2e2e]"
                placeholder={t('sftp.filter')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <button className="icon-btn" title={t('sftp.refresh')} onClick={() => remotePath && refreshRemote(remotePath)}>
              <RefreshCw className="size-3.5" />
            </button>
            <button className="icon-btn" title={t('sftp.newFolder')} onClick={() => setCreating(true)}>
              <FolderPlus className="size-3.5" />
            </button>
            <button
              className="icon-btn"
              title={t('sftp.uploadFile')}
              onClick={async () => startUpload(await window.api.dialog.pickFiles())}
            >
              <Upload className="size-3.5" />
            </button>
            <button
              className="icon-btn"
              title={t('sftp.uploadFolder')}
              onClick={async () => {
                const dir = await window.api.dialog.pickDirectory()
                if (dir) startUpload([dir])
              }}
            >
              <Folder className="size-3.5" />
            </button>
          </>
        ) : (
          <div className="flex-1" />
        )}
        <button
          className={cn('icon-btn', mode === 'split' && '!text-fg bg-white/[0.06]')}
          title={mode === 'panel' ? t('sftp.toSplit') : t('sftp.toPanel')}
          onClick={() => setMode((m) => (m === 'panel' ? 'split' : 'panel'))}
        >
          <Columns2 className="size-3.5" />
        </button>
        <button className="icon-btn" title={t('sftp.hidePanel')} onClick={onClose}>
          <X className="size-3.5" />
        </button>
      </div>

      {/* 列表区（远程区接受拖拽上传） */}
      <div
        className="flex-1 min-h-0 flex relative"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
        }}
        onDrop={handleDrop}
      >
        {mode === 'panel' ? (
          renderRemoteList()
        ) : (
          <>
            {/* 本地侧 */}
            <div className="flex-1 min-w-0 flex flex-col border-r border-white/[0.06]">
              <div className="h-9 shrink-0 flex items-center gap-1.5 px-2.5 border-b border-white/[0.04]">
                <button className="icon-btn" title={t('sftp.upLevel')} onClick={() => localPath && refreshLocal(parentOf(localPath.replace(/\\/g, '/')))}>
                  <ArrowUp className="size-3.5" />
                </button>
                {renderSplitPath('local')}
              </div>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className="flex-1 min-h-0 overflow-y-auto py-1"
                    onClick={(e) => {
                      if (e.target !== e.currentTarget) return
                      setSelLocal(new Set())
                      localAnchorRef.current = null
                    }}
                    onContextMenu={() => {
                      setLocalMenuEntry(localRowTargetRef.current)
                      localRowTargetRef.current = null
                    }}
                  >
                    {local?.error ? (
                      <div className="px-4 py-6 text-center font-mono text-[11px] text-danger">{local.error}</div>
                    ) : (
                      (local?.entries ?? []).map((entry) =>
                        renderEntryRow(entry, {
                          selected: selLocal.has(entry.path),
                          renaming: localRenaming === entry.path,
                          onClick: (e) => handleLocalSelect(entry, e),
                          onDoubleClick: entry.type === 'dir' ? () => refreshLocal(entry.path) : undefined,
                          onContextMenu: () => handleLocalRowContextMenu(entry),
                          onRenameSubmit: (name) => submitLocalRename(entry, name),
                          onRenameCancel: () => setLocalRenaming(null)
                        })
                      )
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {localMenuEntry ? (
                    <>
                      <ContextMenuItem onSelect={uploadSelectedLocal}>
                        {t('sftp.uploadSelected')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        disabled={selLocal.size !== 1}
                        onSelect={() => localMenuEntry && setLocalRenaming(localMenuEntry.path)}
                      >
                        {t('sftp.menuRename')}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => setLocalDeleteAsk(selectedLocalEntries())}>
                        {t('sftp.menuDelete')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onSelect={() => {
                          navigator.clipboard.writeText([...selLocal].join('\n'))
                          toast.success(t('sftp.pathCopied'))
                        }}
                      >
                        {t('sftp.menuCopyPath')}
                      </ContextMenuItem>
                    </>
                  ) : (
                    <ContextMenuItem onSelect={() => localPath && refreshLocal(localPath)}>
                      {t('sftp.refresh')}
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            </div>
            {/* 中间箭头 */}
            <div className="w-9 shrink-0 flex flex-col items-center justify-center gap-2">
              <button
                className="icon-btn"
                title={t('sftp.uploadSelected')}
                onClick={uploadSelectedLocal}
              >
                <ArrowRight className="size-3.5" />
              </button>
              <button
                className="icon-btn"
                title={t('sftp.downloadSelected')}
                onClick={() => {
                  if (!localPath) return
                  downloadToDir(selectedRemoteEntries(), localPath, () => refreshLocal(localPath))
                  setSelRemote(new Set())
                  anchorRef.current = null
                }}
              >
                <ArrowLeft className="size-3.5" />
              </button>
            </div>
            {/* 远程侧 */}
            <div className="flex-1 min-w-0 flex flex-col border-l border-white/[0.06]">
              <div className="h-9 shrink-0 flex items-center gap-1.5 px-2.5 border-b border-white/[0.04]">
                <button className="icon-btn" title={t('sftp.upLevel')} onClick={() => remotePath && refreshRemote(parentOf(remotePath))}>
                  <ArrowUp className="size-3.5" />
                </button>
                {renderSplitPath('remote')}
              </div>
              {renderRemoteList()}
            </div>
          </>
        )}

        {/* 拖拽目标高亮遮罩 */}
        {dragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 border-2 border-dashed border-white/25 pointer-events-none">
            <span className="font-mono text-[12px] text-fg">{t('sftp.dropTo', { path: remotePath })}</span>
          </div>
        )}
      </div>

      {/* 传输队列 */}
      {transfers.length > 0 && (
        <div className="shrink-0 border-t border-white/[0.06]">
          <div className="h-6 flex items-center justify-between px-3 border-b border-white/[0.04]">
            <span className="font-mono text-[10px] tracking-[0.1em] text-ghost">{t('sftp.queue')}</span>
            <button
              className="font-mono text-[10px] text-faint hover:text-dim cursor-pointer outline-none transition-colors"
              onClick={() => clearCompleted(sessionId)}
            >
              {t('sftp.clearCompleted')}
            </button>
          </div>
          <div className="max-h-[110px] overflow-y-auto py-0.5">
            {transfers.map((t) => (
              <TransferRow key={t.taskId} item={t} />
            ))}
          </div>
        </div>
      )}

      {/* 同名冲突策略弹窗：对整个下载任务生效 */}
      <Dialog
        open={conflictAsk !== null}
        onOpenChange={(open) => {
          if (!open) {
            conflictAsk?.resolve(null)
            setConflictAsk(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sftp.conflictTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="font-mono text-[11px] text-dim leading-relaxed break-all">
              {t('sftp.conflictDesc', { names: conflictAsk?.names.join('、') ?? '' })}
            </p>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button size="sm" onClick={() => { conflictAsk?.resolve(null); setConflictAsk(null) }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => { conflictAsk?.resolve('skip'); setConflictAsk(null) }}>
              {t('sftp.conflictSkip')}
            </Button>
            <Button size="sm" onClick={() => { conflictAsk?.resolve('rename'); setConflictAsk(null) }}>
              {t('sftp.conflictRename')}
            </Button>
            <Button size="sm" variant="solid" onClick={() => { conflictAsk?.resolve('overwrite'); setConflictAsk(null) }}>
              {t('sftp.conflictOverwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteAsk !== null} onOpenChange={(open) => !open && setDeleteAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sftp.deleteTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="font-mono text-[11px] text-dim leading-relaxed break-all">
              {t('sftp.deleteDesc', {
                names: (deleteAsk ?? []).map((e) => e.name).join('、')
              })}
            </p>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button size="sm" onClick={() => setDeleteAsk(null)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="solid" className="!text-danger !border-danger/40" onClick={confirmDelete}>
              {t('sftp.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={localDeleteAsk !== null} onOpenChange={(open) => !open && setLocalDeleteAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sftp.localDeleteTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="font-mono text-[11px] text-dim leading-relaxed break-all">
              {t('sftp.localDeleteDesc', {
                names: (localDeleteAsk ?? []).map((entry) => entry.name).join('、')
              })}
            </p>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button size="sm" onClick={() => setLocalDeleteAsk(null)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="solid" className="!text-danger !border-danger/40" onClick={confirmLocalDelete}>
              {t('sftp.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 队列行：↑ 上传绿 / ↓ 下载蓝、文件名、大小、进度条、百分比、暂停/续传/移除 */
function TransferRow({ item }: { item: TransferItem }) {
  const { t } = useTranslation()
  const pct = item.total > 0 ? Math.min(100, Math.round((item.transferred / item.total) * 100)) : 0
  const active = item.status === 'running' || item.status === 'paused'
  return (
    <div className="flex items-center gap-2 px-3 py-[4px] font-mono text-[11px]">
      {item.direction === 'up' ? (
        <ArrowUp className="size-3 shrink-0" style={{ color: '#4ade80' }} />
      ) : (
        <ArrowDown className="size-3 shrink-0" style={{ color: '#60a5fa' }} />
      )}
      <span className="w-[180px] truncate text-dim" title={item.name}>{item.name}</span>
      <span className="w-[128px] shrink-0 whitespace-nowrap text-right text-faint">
        {fmtSize(item.transferred)} / {item.total > 0 ? fmtSize(item.total) : '…'}
      </span>
      <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-[width] duration-200',
            item.status === 'error' ? 'bg-danger' : item.direction === 'up' ? 'bg-ok' : ''
          )}
          style={{
            width: `${pct}%`,
            background: item.status === 'error' ? undefined : item.direction === 'down' ? '#60a5fa' : undefined
          }}
        />
      </div>
      <span className="w-[36px] text-right text-faint shrink-0">
        {item.status === 'done' ? t('sftp.done') : item.status === 'cancelled' ? t('sftp.cancelled') : item.status === 'error' ? t('sftp.failed') : `${pct}%`}
      </span>
      {item.status === 'running' && (
        <button className="icon-btn !p-0.5" title={t('sftp.pause')} onClick={() => window.api.sftp.pause(item.taskId)}>
          <Pause className="size-3" />
        </button>
      )}
      {item.status === 'paused' && (
        <button className="icon-btn !p-0.5" title={t('sftp.resume')} onClick={() => window.api.sftp.resume(item.taskId)}>
          <Play className="size-3" />
        </button>
      )}
      {active && (
        <button className="icon-btn !p-0.5" title={t('sftp.cancelTask')} onClick={() => removeTransfer(item.taskId)}>
          <Square className="size-2.5" />
        </button>
      )}
      {!active && (
        <button className="icon-btn !p-0.5" title={t('sftp.remove')} onClick={() => removeTransfer(item.taskId)}>
          <X className="size-3" />
        </button>
      )}
      {item.status === 'error' && (
        <span className="text-danger text-[10px] truncate max-w-[140px]" title={item.message}>{item.message}</span>
      )}
    </div>
  )
}
