import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { HostConfig, HostGroup, HostInput, SessionStatus } from '@shared/types'
import { TabBar, type PaneSide, type TabAction, type WorkspaceTab } from '@/components/TabBar'
import { TerminalView } from '@/components/TerminalView'
import { SessionInfoBar } from '@/components/SessionInfoBar'
import { SftpPanel } from '@/components/SftpPanel'
import { MonitorPanel } from '@/components/MonitorPanel'
import { ConnectionDialog } from '@/components/ConnectionDialog'
import { CredentialsDialog } from '@/components/CredentialsDialog'
import { SettingsWorkspace } from '@/components/SettingsDialog'
import { EmptyState, type ConnectionAddress } from '@/components/EmptyState'
import { ConnectionHub, type HostAction } from '@/components/ConnectionHub'
import { GroupManagerDialog } from '@/components/GroupManagerDialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { getTerminal } from '@/lib/terminals'
import { setSettings, useSettings } from '@/lib/settings'
import { useBackgroundMonitor } from '@/lib/useBackgroundMonitor'
import { cn } from '@/lib/utils'

/** 会话：标签数据 + 完整主机配置（重连 / 复制会话要用） */
interface SessionState {
  sessionId: string
  host: HostConfig
  status: SessionStatus
}

/** 断线自动重连参数：指数退避 2s/4s/8s，最多 3 次 */
const RETRY_DELAYS = [2000, 4000, 8000]
const SETTINGS_TAB_ID = '__settings__'

function appendBeforeSettings(tabs: string[], tabId: string): string[] {
  const settingsIndex = tabs.indexOf(SETTINGS_TAB_ID)
  if (settingsIndex < 0) return [...tabs, tabId]
  return [...tabs.slice(0, settingsIndex), tabId, ...tabs.slice(settingsIndex)]
}

export default function App() {
  const { t } = useTranslation()
  const settings = useSettings()
  const [hosts, setHosts] = useState<HostConfig[]>([])
  const [hostGroups, setHostGroups] = useState<HostGroup[]>([])
  const [sessions, setSessions] = useState<SessionState[]>([])
  // 双窗格：right 为 null 表示未分屏；标签按 id 列表维护顺序
  const [leftTabs, setLeftTabs] = useState<string[]>([])
  const [rightTabs, setRightTabs] = useState<string[] | null>(null)
  const [activeLeft, setActiveLeft] = useState<string | null>(null)
  const [activeRight, setActiveRight] = useState<string | null>(null)
  const [blankTabs, setBlankTabs] = useState<Set<string>>(() => new Set())
  const [focusSide, setFocusSide] = useState<PaneSide>('left')
  const [ratio, setRatio] = useState(0.5)
  // 每会话独立的 SFTP / 监控开关状态（面板本体属 M3）
  const [sftpOpen, setSftpOpen] = useState<Record<string, boolean>>({})
  const [monitorOpen, setMonitorOpen] = useState<Record<string, boolean>>({})

  // 后台监控：采集状态提升到 App，按 session 维护
  const connectedSessionIds = useMemo(
    () => sessions.filter((s) => s.status === 'connected').map((s) => s.sessionId),
    [sessions]
  )
  const execFor = useCallback(
    (sessionId: string) => (command: string) => window.api.ssh.exec(sessionId, command),
    []
  )
  const { states: monitorStates, openMonitor, closeMonitor, togglePause, setIface } = useBackgroundMonitor(
    execFor,
    connectedSessionIds,
    settings.monitorBackgroundEnabled,
    settings.monitorRefreshInterval
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [connectionDialogFromHub, setConnectionDialogFromHub] = useState(false)
  const [editingHost, setEditingHost] = useState<HostConfig | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [groupManagerTarget, setGroupManagerTarget] = useState<string | null>(null)
  const [groupManagerAction, setGroupManagerAction] = useState<'edit' | 'delete' | null>(null)
  const [initialConnectionGroup, setInitialConnectionGroup] = useState<string | null>(null)
  const [connectionAddress, setConnectionAddress] = useState<ConnectionAddress | null>(null)

  const panesRef = useRef<HTMLDivElement>(null)
  // toast 去重：同一会话同一状态只提示一次
  const toastedRef = useRef(new Set<string>())
  // 自动重连控制：曾连接成功才具备重连资格；手动断开的会话不重连
  const wasConnectedRef = useRef(new Set<string>())
  const manualRef = useRef(new Set<string>())
  const retryCountRef = useRef(new Map<string, number>())
  const retryTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // 状态处理里要用最新的 sessions（重连时取 host），用 ref 同步
  const sessionsRef = useRef<SessionState[]>([])
  sessionsRef.current = sessions

  useEffect(() => {
    window.api.hosts.list().then(setHosts)
    window.api.groups.list().then(setHostGroups)
  }, [])

  // 云同步拉取应用了远端变更时，重新加载主机列表保持侧栏一致
  useEffect(() => {
    return window.api.cloudSync.onApplied(() => {
      window.api.hosts.list().then(setHosts)
      window.api.groups.list().then(setHostGroups)
    })
  }, [])

  /** 清理某会话的重连计时器与计数 */
  const clearRetry = useCallback((sessionId: string) => {
    const timer = retryTimerRef.current.get(sessionId)
    if (timer) clearTimeout(timer)
    retryTimerRef.current.delete(sessionId)
    retryCountRef.current.delete(sessionId)
  }, [])

  /** 发起（重）连接：复用同一 sessionId，终端回滚保留 */
  const doConnect = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((s) => s.sessionId === sessionId)
      if (!session) return
      manualRef.current.delete(sessionId)
      const handle = getTerminal(sessionId)
      const size = handle ? { cols: handle.term.cols, rows: handle.term.rows } : { cols: 80, rows: 24 }
      setSessions((prev) =>
        prev.map((s) => (s.sessionId === sessionId ? { ...s, status: 'connecting' } : s))
      )
      handle?.term.write('\r\n\x1b[90m—— 正在连接… ——\x1b[0m\r\n')
      window.api.ssh.connect(sessionId, session.host, size)
    },
    []
  )

  /** 断线后按退避序列自动重连 */
  const scheduleReconnect = useCallback(
    (sessionId: string) => {
      // ssh2 的 error/close 可能属于同一次断线，只保留一个待执行的重连任务。
      if (retryTimerRef.current.has(sessionId)) return
      const attempt = retryCountRef.current.get(sessionId) ?? 0
      if (attempt >= RETRY_DELAYS.length) {
        clearRetry(sessionId)
        wasConnectedRef.current.delete(sessionId)
        toast.error(t('toast.reconnectFailed'))
        return
      }
      retryCountRef.current.set(sessionId, attempt + 1)
      toast.warning(t('toast.reconnecting', { seconds: RETRY_DELAYS[attempt] / 1000, attempt: attempt + 1, total: RETRY_DELAYS.length }))
      const timer = setTimeout(() => {
        retryTimerRef.current.delete(sessionId)
        doConnect(sessionId)
      }, RETRY_DELAYS[attempt])
      retryTimerRef.current.set(sessionId, timer)
    },
    [clearRetry, doConnect]
  )

  // 全局订阅会话状态：更新标签状态点 + toast 反馈 + 断线自动重连
  useEffect(() => {
    return window.api.ssh.onStatus((ev) => {
      setSessions((prev) =>
        prev.map((s) => (s.sessionId === ev.sessionId ? { ...s, status: ev.status } : s))
      )
      if (ev.status === 'connected') {
        wasConnectedRef.current.add(ev.sessionId)
        manualRef.current.delete(ev.sessionId)
        clearRetry(ev.sessionId)
        if (settings.monitorEnabledByDefault || settings.monitorBackgroundEnabled) {
          openMonitor(ev.sessionId)
        }
        if (settings.monitorEnabledByDefault) {
          setMonitorOpen((prev) => {
            if (prev[ev.sessionId]) return prev
            setSftpOpen((s) => ({ ...s, [ev.sessionId]: false }))
            return { ...prev, [ev.sessionId]: true }
          })
        }
        const key = `${ev.sessionId}:connected`
        if (!toastedRef.current.has(key)) {
          toastedRef.current.add(key)
          toast.success(t('toast.connected'))
        }
      } else if (ev.status === 'error') {
        if (wasConnectedRef.current.has(ev.sessionId) && !manualRef.current.has(ev.sessionId)) {
          // 会话中网络错误（ssh2 随后只会触发 close 兜底，'closed' 未必再发）→ 自动重连
          scheduleReconnect(ev.sessionId)
        } else {
          const key = `${ev.sessionId}:error`
          if (!toastedRef.current.has(key)) {
            toastedRef.current.add(key)
            toast.error(t('toast.connectFailed', { message: ev.message ?? t('common.unknown') }))
          }
        }
      } else if (ev.status === 'closed') {
        if (wasConnectedRef.current.has(ev.sessionId) && !manualRef.current.has(ev.sessionId)) {
          scheduleReconnect(ev.sessionId)
        }
      }
    })
  }, [clearRetry, scheduleReconnect, settings.monitorEnabledByDefault, settings.monitorBackgroundEnabled, openMonitor])

  /** 新建会话并入指定窗格（不发起连接，连接由 TerminalView 挂载时触发） */
  const createSession = useCallback((host: HostConfig, side: PaneSide, replaceTabId?: string) => {
    const sessionId = replaceTabId ?? crypto.randomUUID()
    setSessions((prev) => [...prev, { sessionId, host, status: 'connecting' }])
    if (replaceTabId) {
      setBlankTabs((prev) => {
        const next = new Set(prev)
        next.delete(replaceTabId)
        return next
      })
    } else {
      if (side === 'right') setRightTabs((prev) => [...(prev ?? []), sessionId])
      else setLeftTabs((prev) => appendBeforeSettings(prev, sessionId))
    }
    if (side === 'right') setActiveRight(sessionId)
    else setActiveLeft(sessionId)
    setFocusSide(side)
    return sessionId
  }, [])

  /** `+` 只创建空白标签，选择主机后再复用该 id 建立真实会话。 */
  const createBlankTab = useCallback((side: PaneSide) => {
    const tabId = crypto.randomUUID()
    setBlankTabs((prev) => new Set(prev).add(tabId))
    if (side === 'right') {
      setRightTabs((prev) => [...(prev ?? []), tabId])
      setActiveRight(tabId)
    } else {
      setLeftTabs((prev) => appendBeforeSettings(prev, tabId))
      setActiveLeft(tabId)
    }
    setFocusSide(side)
  }, [])

  /** 设置以独立管理弹窗打开，保留当前终端或启动页作为背景。 */
  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  /** 点击主机：已有活会话则激活，否则在焦点窗格新建 */
  const connectHost = useCallback(
    (host: HostConfig) => {
      const targetSide = rightTabs !== null ? focusSide : 'left'
      const activeId = targetSide === 'right' ? activeRight : activeLeft
      if (activeId && blankTabs.has(activeId)) {
        createSession(host, targetSide, activeId)
        return
      }
      const existing = sessionsRef.current.find(
        (s) => s.host.id === host.id && s.status !== 'closed' && s.status !== 'error'
      )
      if (existing) {
        if (rightTabs?.includes(existing.sessionId)) {
          setActiveRight(existing.sessionId)
          setFocusSide('right')
        } else {
          setActiveLeft(existing.sessionId)
          setFocusSide('left')
        }
        return
      }
      createSession(host, targetSide)
    },
    [activeLeft, activeRight, blankTabs, createSession, focusSide, rightTabs]
  )

  /** 从标签列表移除（不触碰 ssh 通道）；返回移除后该侧的新激活 id */
  const removeTab = useCallback(
    (side: PaneSide, sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId))
      setBlankTabs((prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
      if (side === 'right') {
        setRightTabs((prev) => {
          const next = (prev ?? []).filter((id) => id !== sessionId)
          if (next.length === 0) {
            // 副屏标签全部关闭 → 分屏自动收起
            setActiveRight(null)
            setFocusSide('left')
            return null
          }
          setActiveRight((cur) => (cur === sessionId ? next[next.length - 1] : cur))
          return next
        })
      } else {
        setLeftTabs((prev) => {
          const next = prev.filter((id) => id !== sessionId)
          setActiveLeft((cur) => (cur === sessionId ? (next[next.length - 1] ?? null) : cur))
          return next
        })
      }
    },
    []
  )

  // 左窗格空了但副屏还有标签 → 副屏提升为主屏
  useEffect(() => {
    if (leftTabs.length === 0 && rightTabs && rightTabs.length > 0) {
      setLeftTabs(rightTabs)
      setActiveLeft(activeRight)
      setRightTabs(null)
      setActiveRight(null)
      setFocusSide('left')
    }
  }, [leftTabs, rightTabs, activeRight])

  /** 关闭标签（断开通道并移除） */
  const closeSession = useCallback(
    (side: PaneSide, sessionId: string) => {
      if (sessionsRef.current.some((session) => session.sessionId === sessionId)) {
        manualRef.current.add(sessionId)
        clearRetry(sessionId)
        window.api.ssh.disconnect(sessionId)
      }
      removeTab(side, sessionId)
    },
    [clearRetry, removeTab]
  )

  /** 标签右键菜单动作分发 */
  const handleTabAction = useCallback(
    (side: PaneSide, sessionId: string, action: TabAction) => {
      const session = sessionsRef.current.find((s) => s.sessionId === sessionId)
      if (!session) return
      switch (action) {
        case 'reconnect':
          clearRetry(sessionId)
          doConnect(sessionId)
          break
        case 'disconnect':
          // 断开但保留标签和终端回滚，并在终端中明确标记连接已关闭。
          manualRef.current.add(sessionId)
          clearRetry(sessionId)
          window.api.ssh.disconnect(sessionId)
          getTerminal(sessionId)?.term.write(
            `\r\n\x1b[90mConnection to ${session.host.host} closed.\x1b[0m\r\n`
          )
          setSessions((prev) =>
            prev.map((s) => (s.sessionId === sessionId ? { ...s, status: 'closed' } : s))
          )
          break
        case 'toggleSftp':
          if (session.status !== 'connected') break
          if (side === 'right') setActiveRight(sessionId)
          else setActiveLeft(sessionId)
          setFocusSide(side)
          setSftpOpen((prev) => {
            const next = !prev[sessionId]
            if (next) setMonitorOpen((m) => ({ ...m, [sessionId]: false }))
            return { ...prev, [sessionId]: next }
          })
          break
        case 'toggleMonitor':
          if (session.status !== 'connected') break
          if (side === 'right') setActiveRight(sessionId)
          else setActiveLeft(sessionId)
          setFocusSide(side)
          setMonitorOpen((prev) => {
            const next = !prev[sessionId]
            if (next) {
              setSftpOpen((s) => ({ ...s, [sessionId]: false }))
              openMonitor(sessionId)
            } else {
              closeMonitor(sessionId)
            }
            return { ...prev, [sessionId]: next }
          })
          break
        case 'close':
          closeSession(side, sessionId)
          break
        case 'closeOthers': {
          const ids = (side === 'right' ? (rightTabs ?? []) : leftTabs).filter(
            (id) => id !== sessionId && id !== SETTINGS_TAB_ID
          )
          ids.forEach((id) => closeSession(side, id))
          break
        }
        case 'closeRight': {
          const tabs = side === 'right' ? (rightTabs ?? []) : leftTabs
          const idx = tabs.indexOf(sessionId)
          tabs
            .slice(idx + 1)
            .filter((id) => id !== SETTINGS_TAB_ID)
            .forEach((id) => closeSession(side, id))
          break
        }
        case 'closeAll': {
          const keepSettings = leftTabs.includes(SETTINGS_TAB_ID)
          ;[...leftTabs, ...(rightTabs ?? [])]
            .filter((id) => id !== SETTINGS_TAB_ID)
            .forEach((id) => {
              manualRef.current.add(id)
              clearRetry(id)
              if (sessionsRef.current.some((session) => session.sessionId === id)) {
                window.api.ssh.disconnect(id)
              }
            })
          setSessions([])
          setLeftTabs(keepSettings ? [SETTINGS_TAB_ID] : [])
          setRightTabs(null)
          setActiveLeft(keepSettings ? SETTINGS_TAB_ID : null)
          setActiveRight(null)
          setBlankTabs(new Set())
          setFocusSide('left')
          break
        }
        case 'duplicate':
          createSession(session.host, side)
          break
        case 'splitRight':
          // 向右分屏：把该会话复制到副屏标签组（未分屏时自动开启）
          createSession(session.host, 'right')
          break
        case 'moveToWindow': {
          // 移到新窗口：先取终端快照交给主进程开新窗，本地只移除标签不断开通道
          const snapshot = getTerminal(sessionId)?.serialize.serialize() ?? ''
          window.api.window.openDetached(sessionId, snapshot)
          removeTab(side, sessionId)
          break
        }
      }
    },
    [clearRetry, closeSession, createSession, doConnect, leftTabs, removeTab, rightTabs]
  )

  /** New Connection 提交：持久化主机并立即连接 */
  const handleNewConnection = useCallback(
    async (input: HostInput) => {
      try {
        const saved = await window.api.hosts.add(input)
        setHosts((prev) => [...prev, saved])
        window.api.groups.list().then(setHostGroups)
        setDialogOpen(false)
        setConnectionAddress(null)
        setInitialConnectionGroup(null)
        connectHost(saved)
      } catch (err) {
        toast.error(t('toast.saveHostFailed', { message: err instanceof Error ? err.message : String(err) }))
      }
    },
    [connectHost, t]
  )

  /** 编辑主机：更新持久化并刷新本地列表 */
  const handleUpdateHost = useCallback(
    async (id: string, input: HostInput) => {
      try {
        const updated = await window.api.hosts.update(id, input)
        setHosts((prev) => prev.map((h) => (h.id === id ? updated : h)))
        window.api.groups.list().then(setHostGroups)
        // 同步刷新已打开会话里的主机信息（标签标题等）
        setSessions((prev) =>
          prev.map((s) => (s.host.id === id ? { ...s, host: updated } : s))
        )
        setDialogOpen(false)
        setEditingHost(null)
      } catch (err) {
        toast.error(t('toast.updateHostFailed', { message: err instanceof Error ? err.message : String(err) }))
      }
    },
    [t]
  )

  /** 删除主机 */
  const handleDeleteHost = useCallback(
    async (host: HostConfig) => {
      try {
        await window.api.hosts.delete(host.id)
        setHosts((prev) => prev.filter((h) => h.id !== host.id))
        toast.success(t('toast.hostDeleted'))
      } catch (err) {
        toast.error(t('toast.deleteHostFailed', { message: err instanceof Error ? err.message : String(err) }))
      }
    },
    [t]
  )

  const handleCreateGroup = useCallback(async (name: string) => {
    try {
      const created = await window.api.groups.create(name)
      setHostGroups((current) => [...current, created])
      toast.success(t('toast.groupCreated'))
      return true
    } catch (err) {
      toast.error(t('toast.groupFailed', { message: err instanceof Error ? err.message : String(err) }))
      return false
    }
  }, [t])

  const handleRenameGroup = useCallback(async (currentName: string, nextName: string) => {
    try {
      await window.api.groups.rename(currentName, nextName)
      const [nextGroups, nextHosts] = await Promise.all([window.api.groups.list(), window.api.hosts.list()])
      setHostGroups(nextGroups)
      setHosts(nextHosts)
      setSessions((current) => current.map((session) => ({
        ...session,
        host: nextHosts.find((host) => host.id === session.host.id) ?? session.host
      })))
      toast.success(t('toast.groupRenamed'))
      return true
    } catch (err) {
      toast.error(t('toast.groupFailed', { message: err instanceof Error ? err.message : String(err) }))
      return false
    }
  }, [t])

  const handleDeleteGroup = useCallback(async (name: string) => {
    try {
      await window.api.groups.delete(name)
      const [nextGroups, nextHosts] = await Promise.all([window.api.groups.list(), window.api.hosts.list()])
      setHostGroups(nextGroups)
      setHosts(nextHosts)
      setSessions((current) => current.map((session) => ({
        ...session,
        host: nextHosts.find((host) => host.id === session.host.id) ?? session.host
      })))
      toast.success(t('toast.groupDeleted'))
      return true
    } catch (err) {
      toast.error(t('toast.groupFailed', { message: err instanceof Error ? err.message : String(err) }))
      return false
    }
  }, [t])

  const handleReorderGroups = useCallback(async (names: string[]) => {
    try {
      setHostGroups(await window.api.groups.reorder(names))
      return true
    } catch (err) {
      toast.error(t('toast.groupFailed', { message: err instanceof Error ? err.message : String(err) }))
      return false
    }
  }, [t])

  /** 主机右键菜单动作分发；连接管理来源在编辑完成后返回连接列表。 */
  const handleHostAction = useCallback(
    (host: HostConfig, action: HostAction, fromConnections = true) => {
      if (fromConnections) setConnectionsOpen(false)
      switch (action) {
        case 'connect':
          connectHost(host)
          break
        case 'edit':
          setEditingHost(host)
          setConnectionDialogFromHub(fromConnections)
          setDialogOpen(true)
          break
        case 'duplicate': {
          const duplicate: HostInput = {
            label: host.label ? `${host.label} ${t('sidebar.copySuffix')}` : '',
            description: host.description,
            host: host.host,
            port: host.port,
            username: host.username,
            group: host.group,
            auth: host.auth
          }
          handleNewConnection(duplicate)
          break
        }
        case 'splitRight':
          createSession(host, 'right')
          break
        case 'delete':
          handleDeleteHost(host)
          break
      }
    },
    [connectHost, createSession, handleDeleteHost, handleNewConnection, t]
  )

  const handleRecentHostAction = useCallback(
    (host: HostConfig, action: HostAction) => handleHostAction(host, action, false),
    [handleHostAction]
  )

  /** 分屏拖拽条：左右窗格比例限制 20%–80% */
  const startDragRatio = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = panesRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => {
      const next = (ev.clientX - rect.left) / rect.width
      setRatio(Math.min(0.8, Math.max(0.2, next)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const sessionsById = useMemo(
    () => new Map(sessions.map((s) => [s.sessionId, s])),
    [sessions]
  )
  const toTabs = useCallback(
    (ids: string[]): WorkspaceTab[] => {
      const tabs: WorkspaceTab[] = []
      for (const id of ids) {
        if (id === SETTINGS_TAB_ID) {
          tabs.push({ kind: 'settings', sessionId: id, title: t('settings.title') })
          continue
        }
        const session = sessionsById.get(id)
        if (session) {
          tabs.push({
            kind: 'session',
            sessionId: session.sessionId,
            hostId: session.host.id,
            title: session.host.label || `${session.host.username}@${session.host.host}`,
            detail: `${session.host.username}@${session.host.host}:${session.host.port} · ${t(`infoBar.${session.status}`)}`,
            status: session.status,
            sftpOpen: !!sftpOpen[session.sessionId],
            monitorOpen: !!monitorOpen[session.sessionId]
          })
        } else if (blankTabs.has(id)) {
          tabs.push({ kind: 'blank', sessionId: id, title: t('tabs.newTab') })
        }
      }
      return tabs
    },
    [blankTabs, sessionsById, sftpOpen, monitorOpen, t]
  )
  const leftTabData = useMemo(() => toTabs(leftTabs), [toTabs, leftTabs])
  const rightTabData = useMemo(() => (rightTabs ? toTabs(rightTabs) : null), [toTabs, rightTabs])

  const sessionHostIds = useMemo(
    () =>
      new Set(
        sessions
          .filter((s) => s.status === 'connected' || s.status === 'connecting')
          .map((s) => s.host.id)
      ),
    [sessions]
  )
  const activeHostId = useMemo(() => {
    const activeId = focusSide === 'right' ? activeRight : activeLeft
    return sessionsById.get(activeId ?? '')?.host.id ?? null
  }, [sessionsById, focusSide, activeLeft, activeRight])

  const split = rightTabs !== null

  /** 单个窗格：会话信息栏 + 该侧全部终端（显隐切换，不销毁）+ SFTP 面板 */
  const renderPane = (side: PaneSide, ids: string[]) => {
    const activeId = side === 'right' ? activeRight : activeLeft
    const active = activeId ? sessionsById.get(activeId) : undefined
    const activeIsBlank = !!activeId && blankTabs.has(activeId)
    return (
      <div
        className="settings-pane h-full flex flex-col min-w-0"
        onMouseDownCapture={() => setFocusSide(side)}
      >
        {settings.showSessionInfoBar && active && !activeIsBlank && (
          <SessionInfoBar
            host={active.host}
            status={active.status}
            sftpOpen={!!sftpOpen[active.sessionId]}
            onToggleSftp={() =>
              setSftpOpen((prev) => {
                const next = !prev[active.sessionId]
                if (next) setMonitorOpen((m) => ({ ...m, [active.sessionId]: false }))
                return { ...prev, [active.sessionId]: next }
              })
            }
            monitorOpen={!!monitorOpen[active.sessionId]}
            onToggleMonitor={() =>
              setMonitorOpen((prev) => {
                const next = !prev[active.sessionId]
                if (next) {
                  setSftpOpen((s) => ({ ...s, [active.sessionId]: false }))
                  openMonitor(active.sessionId)
                } else {
                  closeMonitor(active.sessionId)
                }
                return { ...prev, [active.sessionId]: next }
              })
            }
            onHide={() => setSettings({ showSessionInfoBar: false })}
          />
        )}
        <div className="relative flex-1 bg-ink min-h-0">
          {ids.map((id) => {
            const session = sessionsById.get(id)
            return session ? (
              <TerminalView
                key={id}
                sessionId={id}
                host={session.host}
                active={id === activeId}
              />
            ) : null
          })}
          {activeIsBlank && (
            <div className="absolute inset-0 z-10 flex">
              <EmptyState
                hosts={hosts}
                sessionHostIds={sessionHostIds}
                showConnectionsAction={false}
                onConnect={connectHost}
                onHostAction={handleRecentHostAction}
                onNewConnection={(address) => {
                  setConnectionAddress(address ?? null)
                  setEditingHost(null)
                  setConnectionDialogFromHub(false)
                  setDialogOpen(true)
                }}
                onOpenConnections={() => setConnectionsOpen(true)}
              />
            </div>
          )}
        </div>
        {active && sftpOpen[active.sessionId] && active.status === 'connected' && (
          <SftpPanel
            sessionId={active.sessionId}
            onClose={() => setSftpOpen((prev) => ({ ...prev, [active.sessionId]: false }))}
          />
        )}
        {active && monitorOpen[active.sessionId] && !sftpOpen[active.sessionId] && active.status === 'connected' && (
          <MonitorPanel
            sessionId={active.sessionId}
            state={monitorStates[active.sessionId] ?? {
              samples: [],
              hostInfo: null,
              selectedIface: '',
              loading: true,
              error: null,
              paused: false
            }}
            onClose={() => setMonitorOpen((prev) => ({ ...prev, [active.sessionId]: false }))}
            onTogglePause={() => togglePause(active.sessionId)}
            onChangeIface={(iface) => setIface(active.sessionId, iface)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex overflow-hidden select-none">
      <div className="flex-1 min-w-0 flex flex-col">
        <TabBar
          leftTabs={leftTabData}
          rightTabs={rightTabData}
          activeLeft={activeLeft}
          activeRight={activeRight}
          focusSide={focusSide}
          ratio={ratio}
          onActivate={(side, id) => {
            if (side === 'right') setActiveRight(id)
            else setActiveLeft(id)
            setFocusSide(side)
          }}
          onClose={closeSession}
          onNew={createBlankTab}
          onOpenConnections={() => setConnectionsOpen(true)}
          onOpenSettings={openSettings}
          onAction={handleTabAction}
        />
        {leftTabs.length === 0 ? (
          <EmptyState
            hosts={hosts}
            sessionHostIds={sessionHostIds}
            showConnectionsAction
            onConnect={connectHost}
            onHostAction={handleRecentHostAction}
            onNewConnection={(address) => {
              setConnectionAddress(address ?? null)
              setEditingHost(null)
              setConnectionDialogFromHub(false)
              setDialogOpen(true)
            }}
            onOpenConnections={() => setConnectionsOpen(true)}
          />
        ) : (
          <div ref={panesRef} className="flex-1 flex min-h-0">
            <div style={{ width: split ? `${ratio * 100}%` : '100%' }} className="min-w-0">
              {renderPane('left', leftTabs)}
            </div>
            {split && (
              <>
                {/* 分屏拖拽条 */}
                <div
                  className={cn(
                    'w-[5px] shrink-0 cursor-col-resize bg-white/[0.04] hover:bg-white/[0.12] transition-colors'
                  )}
                  onMouseDown={startDragRatio}
                />
                <div className="flex-1 min-w-0">{renderPane('right', rightTabs)}</div>
              </>
            )}
          </div>
        )}
      </div>
      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            if (connectionDialogFromHub) setConnectionsOpen(true)
            setEditingHost(null)
            setConnectionAddress(null)
            setInitialConnectionGroup(null)
            setConnectionDialogFromHub(false)
          }
        }}
        onBack={
          connectionDialogFromHub
            ? () => {
                setDialogOpen(false)
                setConnectionsOpen(true)
                setEditingHost(null)
                setConnectionAddress(null)
                setInitialConnectionGroup(null)
                setConnectionDialogFromHub(false)
              }
            : undefined
        }
        host={editingHost}
        initialAddress={connectionAddress}
        initialGroup={initialConnectionGroup}
        onSubmit={handleNewConnection}
        onUpdate={handleUpdateHost}
        existingHosts={hosts}
        availableGroups={hostGroups.map((group) => group.name)}
      />
      <CredentialsDialog
        open={keysOpen}
        onOpenChange={setKeysOpen}
        onBack={() => {
          setKeysOpen(false)
          setConnectionsOpen(true)
        }}
      />
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="settings-dialog h-[680px] w-[720px] max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] overflow-hidden p-0">
          <SettingsWorkspace
            onHostsImported={async () => setHosts(await window.api.hosts.list())}
            activeSessions={sessions.filter((s) => s.status === 'connecting' || s.status === 'connected').length}
          />
        </DialogContent>
      </Dialog>
      <ConnectionHub
        open={connectionsOpen}
        onOpenChange={setConnectionsOpen}
        hosts={hosts}
        hostGroups={hostGroups}
        sessionHostIds={sessionHostIds}
        activeHostId={activeHostId}
        onConnect={connectHost}
        onNewConnection={(group) => {
          setConnectionAddress(null)
          setInitialConnectionGroup(group ?? null)
          setEditingHost(null)
          setConnectionDialogFromHub(true)
          setDialogOpen(true)
        }}
        onOpenCredentials={() => setKeysOpen(true)}
        onOpenGroups={(group, action) => {
          setConnectionsOpen(false)
          setGroupManagerTarget(group ?? null)
          setGroupManagerAction(action ?? null)
          setGroupsOpen(true)
        }}
        onAction={handleHostAction}
      />
      <GroupManagerDialog
        open={groupsOpen}
        onOpenChange={(open) => {
          setGroupsOpen(open)
          if (!open) {
            setGroupManagerTarget(null)
            setGroupManagerAction(null)
          }
        }}
        onBack={() => {
          setGroupsOpen(false)
          setGroupManagerTarget(null)
          setGroupManagerAction(null)
          setConnectionsOpen(true)
        }}
        groups={hostGroups}
        hosts={hosts}
        initialGroup={groupManagerTarget}
        initialAction={groupManagerAction}
        onCreate={handleCreateGroup}
        onRename={handleRenameGroup}
        onDelete={handleDeleteGroup}
        onReorder={handleReorderGroups}
      />
      <Toaster />
    </div>
  )
}
