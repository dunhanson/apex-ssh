import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, PanelsTopLeft, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import type { HostConfig, RecentEntry } from '@shared/types'
import logoUrl from '@/assets/logo.svg'
import type { HostAction } from '@/components/ConnectionHub'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'

export interface ConnectionAddress {
  host: string
  username: string
}

interface DescriptionTooltipState {
  text: string
  left: number
  top: number
}

interface EmptyStateProps {
  hosts: HostConfig[]
  sessionHostIds: Set<string>
  /** 首次无标签时显示标题行入口；空白标签中由顶部标签栏提供入口。 */
  showHeaderActions: boolean
  onConnect: (host: HostConfig) => void
  onHostAction: (host: HostConfig, action: HostAction) => void
  onNewConnection: (address?: ConnectionAddress) => void
  onOpenConnections: () => void
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** 首次启动与空白标签共用的真实连接启动器。 */
export function EmptyState({
  hosts,
  sessionHostIds,
  showHeaderActions,
  onConnect,
  onHostAction,
  onNewConnection,
  onOpenConnections
}: EmptyStateProps) {
  const { t } = useTranslation()
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [query, setQuery] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('')
  const [descriptionTooltip, setDescriptionTooltip] = useState<DescriptionTooltipState | null>(null)

  const refresh = useCallback(() => {
    window.api.recents.list().then(setRecents)
  }, [])

  useEffect(refresh, [refresh])

  const hostById = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts])

  const recentHosts = useMemo(
    () =>
      recents
        .map((entry) => ({ entry, host: hostById.get(entry.hostId) }))
        .filter((item): item is { entry: RecentEntry; host: HostConfig } => !!item.host),
    [hostById, recents]
  )

  const launcherHosts = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return recentHosts.slice(0, 3).map((item) => item.host)
    return hosts
      .filter((host) =>
        [host.label, host.description, host.host, host.username].some((value) =>
          value?.toLowerCase().includes(keyword)
        )
      )
      .slice(0, 4)
  }, [hosts, query, recentHosts])

  const filteredHistory = useMemo(() => {
    const keyword = historyFilter.trim().toLowerCase()
    if (!keyword) return recents
    return recents.filter((entry) => {
      const host = hostById.get(entry.hostId)
      return [host?.label ?? entry.label, host?.description, host?.host ?? entry.host, host?.username ?? entry.username]
        .some((value) => value?.toLowerCase().includes(keyword))
    })
  }, [historyFilter, hostById, recents])

  const showDescription = (event: SyntheticEvent<HTMLElement>, description?: string) => {
    if (!description) return
    const rect = event.currentTarget.getBoundingClientRect()
    const tooltipWidth = Math.min(360, window.innerWidth - 32)
    setDescriptionTooltip({
      text: description,
      left: Math.max(16, Math.min(rect.left + 28, window.innerWidth - tooltipWidth - 16)),
      top: rect.top - 6
    })
  }

  const hideDescription = () => setDescriptionTooltip(null)

  const connectRecent = (entry: RecentEntry) => {
    hideDescription()
    const host = hostById.get(entry.hostId)
    if (!host) {
      toast.error(t('empty.hostDeleted'))
      return
    }
    onConnect(host)
  }

  const submitQuery = () => {
    if (launcherHosts[0]) {
      onConnect(launcherHosts[0])
      return
    }
    const value = query.trim()
    if (!value) return
    const separator = value.lastIndexOf('@')
    onNewConnection({
      username: separator > 0 ? value.slice(0, separator) : '',
      host: separator > 0 ? value.slice(separator + 1) : value
    })
  }

  const removeRecent = async (hostId: string) => {
    hideDescription()
    await window.api.recents.remove(hostId)
    refresh()
  }

  const runHostAction = (host: HostConfig, action: HostAction, closeHistory = false) => {
    hideDescription()
    if (closeHistory) setHistoryOpen(false)
    if (action === 'connect') onConnect(host)
    else onHostAction(host, action)
  }

  const renderRecentMenu = (host: HostConfig | undefined, hostId: string, closeHistory = false) => {
    const hasSession = !!host && sessionHostIds.has(host.id)
    return (
      <ContextMenuContent>
        {host && (
          <>
            <ContextMenuItem onSelect={() => runHostAction(host, 'connect', closeHistory)}>
              {t('sidebar.menuConnect')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => runHostAction(host, 'edit', closeHistory)}>
              {t('sidebar.menuEdit')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => runHostAction(host, 'duplicate', closeHistory)}>
              {t('sidebar.menuDuplicate')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => runHostAction(host, 'splitRight', closeHistory)}>
              {t('sidebar.menuSplitRight')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => removeRecent(hostId)}>{t('empty.removeRecord')}</ContextMenuItem>
        {host && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={hasSession}
              className="flex items-center gap-4 text-warn data-[highlighted]:text-warn"
              onSelect={() => runHostAction(host, 'delete', closeHistory)}
            >
              <span>{t('empty.deleteHost')}</span>
              {hasSession && (
                <span className="ml-auto text-[10px] text-ghost">{t('sidebar.menuDeleteDisabled')}</span>
              )}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    )
  }

  const clearAll = async () => {
    await window.api.recents.clear()
    setHistoryOpen(false)
    refresh()
    toast.success(t('empty.cleared'))
  }

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-ink px-6 py-8">
      <div className="w-[500px] max-w-full flex flex-col gap-[18px]">
        <div className="flex items-center gap-2.5 min-h-7">
          <img src={logoUrl} alt="" className="size-[25px]" />
          <div className="font-mono text-[14px] leading-5 font-medium tracking-[0.14em] text-body">
            APEX <span className="font-sans text-[11px] leading-4 tracking-normal text-faint">SSH</span>
          </div>
          {showHeaderActions && (
            <div className="ml-auto flex items-center gap-0.5">
              <button
                className="launcher-tool"
                title={t('sidebar.newConnection')}
                aria-label={t('sidebar.newConnection')}
                onClick={() => onNewConnection()}
              >
                <Plus className="size-3.5" />
              </button>
              <button
                className="launcher-tool"
                title={t('connections.title')}
                aria-label={t('connections.title')}
                onClick={onOpenConnections}
              >
                <PanelsTopLeft className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="h-12 px-3.5 flex items-center gap-2.5 border border-white/[0.13] rounded-sm bg-panel focus-within:border-white/30 transition-colors">
          <span className="font-mono text-[12px] leading-4 text-dim shrink-0">ssh</span>
          <span className="font-mono text-[12px] leading-4 text-ghost shrink-0">›</span>
          <input
            className="flex-1 min-w-0 bg-transparent border-0 outline-none font-mono text-[14px] leading-5 text-body placeholder:text-ghost"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submitQuery()}
            placeholder={t('empty.quickPlaceholder')}
            autoFocus
          />
          <button
            className="font-sans text-[11px] leading-4 text-ghost hover:text-dim transition-colors cursor-pointer shrink-0"
            onClick={submitQuery}
          >
            {t('empty.confirm')}
          </button>
        </div>

        <div>
          <div className="h-5 flex items-center">
            <span className="font-sans text-[10px] leading-4 uppercase tracking-[0.08em] text-ghost">
              {query ? t('connections.title') : t('empty.recent')}
            </span>
            {!query && recents.length > 3 && (
              <button
                className="ml-auto font-sans text-[11px] leading-4 text-ghost hover:text-dim transition-colors cursor-pointer"
                onClick={() => setHistoryOpen(true)}
              >
                {t('empty.more')}
              </button>
            )}
          </div>
          <div className="border-t border-line">
            {launcherHosts.map((host) => (
              <ContextMenu key={host.id}>
                <ContextMenuTrigger asChild>
                  <button
                    className="launcher-host"
                    aria-describedby={host.description ? 'recent-host-description-tooltip' : undefined}
                    onMouseEnter={(event) => showDescription(event, host.description)}
                    onMouseLeave={hideDescription}
                    onFocus={(event) => showDescription(event, host.description)}
                    onBlur={hideDescription}
                    onContextMenu={hideDescription}
                    onClick={() => {
                      hideDescription()
                      onConnect(host)
                    }}
                  >
                    <span className={`dot ${sessionHostIds.has(host.id) ? 'on' : ''}`} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-mono text-[12px] leading-4 text-body">
                        {host.label || `${host.username}@${host.host}`}
                      </span>
                      {host.description && (
                        <span className="block mt-0.5 truncate font-sans text-[11px] leading-4 text-faint">
                          {host.description}
                        </span>
                      )}
                    </span>
                    <span className="max-w-[48%] truncate font-mono text-[11px] leading-4 text-faint">
                      {host.username}@{host.host}
                    </span>
                    <ChevronRight className="size-3 text-ghost shrink-0" />
                  </button>
                </ContextMenuTrigger>
                {renderRecentMenu(host, host.id)}
              </ContextMenu>
            ))}
            {launcherHosts.length === 0 && (
              <div className="h-[46px] flex items-center font-sans text-[11px] leading-4 text-ghost">
                {query ? t('empty.directHint') : t('empty.noRecent')}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={historyOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) hideDescription()
          setHistoryOpen(nextOpen)
        }}
      >
        <DialogContent className="w-[520px] max-w-[calc(100vw-48px)]">
          <DialogHeader className="flex flex-row items-center gap-2">
            <SquareTerminal className="size-4 text-dim" strokeWidth={1.5} />
            <DialogTitle>{t('empty.history')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              placeholder={t('empty.historyFilter')}
              value={historyFilter}
              onChange={(event) => setHistoryFilter(event.target.value)}
              autoFocus
            />
            <div className="max-h-[320px] overflow-y-auto -mx-1 px-1">
              {filteredHistory.length === 0 ? (
                <div className="py-8 text-center font-sans text-[11px] leading-4 text-ghost">
                  {t('empty.noRecord')}
                </div>
              ) : (
                filteredHistory.map((entry) => {
                  const host = hostById.get(entry.hostId)
                  const name = host?.label || entry.label || `${entry.username}@${entry.host}`
                  const description = host?.description
                  const username = host?.username ?? entry.username
                  const address = host?.host ?? entry.host
                  const port = host?.port ?? entry.port
                  return (
                    <div
                      key={entry.hostId}
                      data-recent-row
                      className="group min-h-12 flex items-center gap-1 px-2 py-2 rounded-sm hover:bg-white/[0.03] focus-within:bg-white/[0.03]"
                    >
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <button
                            className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer outline-none"
                            aria-describedby={description ? 'recent-host-description-tooltip' : undefined}
                            onMouseEnter={(event) => showDescription(event, description)}
                            onMouseLeave={hideDescription}
                            onFocus={(event) => showDescription(event, description)}
                            onBlur={hideDescription}
                            onContextMenu={hideDescription}
                            onClick={() => {
                              setHistoryOpen(false)
                              connectRecent(entry)
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-[12px] leading-4 text-fg truncate">{name}</div>
                              {description && (
                                <div className="mt-0.5 font-sans text-[11px] leading-4 text-faint truncate">
                                  {description}
                                </div>
                              )}
                            </div>
                            <div className="max-w-[46%] shrink-0 text-right">
                              <div className="font-mono text-[11px] leading-4 text-faint truncate">
                                {username}@{address}:{port}
                              </div>
                              <div className="font-sans text-[11px] leading-4 text-ghost">
                                {formatTime(entry.connectedAt)}
                              </div>
                            </div>
                          </button>
                        </ContextMenuTrigger>
                        {renderRecentMenu(host, entry.hostId, true)}
                      </ContextMenu>
                      <button
                        className="icon-btn !p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0"
                        title={t('empty.removeRecord')}
                        onClick={() => removeRecent(entry.hostId)}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            {recents.length > 0 && (
              <button
                className="ml-auto flex items-center gap-1.5 font-sans text-[11px] leading-4 text-faint hover:text-danger transition-colors cursor-pointer"
                onClick={clearAll}
              >
                <Trash2 className="size-3" />
                {t('empty.clearRecent')}
              </button>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      {descriptionTooltip &&
        createPortal(
          <div
            id="recent-host-description-tooltip"
            role="tooltip"
            className="fixed z-[120] -translate-y-full w-max max-w-[min(360px,calc(100vw-32px))] px-2.5 py-1.5 border border-white/[0.14] rounded-sm bg-[#111] shadow-[0_8px_28px_rgba(0,0,0,0.55)] pointer-events-none font-sans text-[11px] leading-4 text-body whitespace-normal break-words"
            style={{ left: descriptionTooltip.left, top: descriptionTooltip.top }}
          >
            {descriptionTooltip.text}
          </div>,
          document.body
        )}
    </div>
  )
}
