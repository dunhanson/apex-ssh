import { useMemo, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, KeyRound, PanelsTopLeft, Plus, Search } from 'lucide-react'
import type { HostConfig } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type HostAction = 'connect' | 'edit' | 'duplicate' | 'splitRight' | 'delete'

interface DescriptionTooltipState {
  text: string
  left: number
  top: number
}

interface ConnectionHubProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hosts: HostConfig[]
  sessionHostIds: Set<string>
  activeHostId: string | null
  onConnect: (host: HostConfig) => void
  onNewConnection: () => void
  onOpenCredentials: () => void
  onAction: (host: HostConfig, action: HostAction) => void
}

/** 按需打开的连接管理，替代常驻主机侧栏。 */
export function ConnectionHub({
  open,
  onOpenChange,
  hosts,
  sessionHostIds,
  activeHostId,
  onConnect,
  onNewConnection,
  onOpenCredentials,
  onAction
}: ConnectionHubProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [descriptionTooltip, setDescriptionTooltip] = useState<DescriptionTooltipState | null>(null)

  const groups = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    const matched = keyword
      ? hosts.filter((host) =>
          [host.label, host.description, host.host, host.username].some((value) =>
            value?.toLowerCase().includes(keyword)
          )
        )
      : hosts
    const grouped = new Map<string, HostConfig[]>()
    for (const host of matched) {
      const group = host.group?.trim() || t('sidebar.defaultGroup')
      grouped.set(group, [...(grouped.get(group) ?? []), host])
    }
    return [...grouped.entries()]
  }, [filter, hosts, t])

  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const connect = (host: HostConfig) => {
    setDescriptionTooltip(null)
    onOpenChange(false)
    onConnect(host)
  }

  const showDescription = (event: SyntheticEvent<HTMLButtonElement>, description?: string) => {
    if (!description) return
    const rect = event.currentTarget.getBoundingClientRect()
    const tooltipWidth = Math.min(360, window.innerWidth - 32)
    setDescriptionTooltip({
      text: description,
      left: Math.max(16, Math.min(rect.left + 36, window.innerWidth - tooltipWidth - 16)),
      top: rect.top - 6
    })
  }

  const hideDescription = () => setDescriptionTooltip(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) hideDescription()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="w-[760px] max-w-[calc(100vw-64px)] max-h-[calc(100vh-88px)] flex flex-col overflow-hidden">
        <DialogHeader className="flex flex-row items-center gap-2.5 py-3.5 pr-12">
          <PanelsTopLeft className="size-4 text-dim" strokeWidth={1.5} />
          <DialogTitle className="font-sans text-[16px] leading-6 tracking-normal">{t('connections.title')}</DialogTitle>
          <span className="font-sans text-[11px] leading-4 text-ghost">
            {t('connections.savedCount', { count: hosts.length })}
          </span>
          <div className="flex-1" />
          <button
            className="app-no-drag flex items-center gap-1.5 h-7 px-2.5 border border-line-strong rounded-sm font-mono text-[12px] leading-4 text-dim hover:text-fg hover:border-white/20 transition-colors cursor-pointer"
            title={t('sidebar.newConnection')}
            onClick={() => {
              onOpenChange(false)
              onNewConnection()
            }}
          >
            <Plus className="size-3" />
            {t('sidebar.newConnection')}
          </button>
        </DialogHeader>

        <DialogBody className="flex-1 min-h-0 flex flex-col gap-3.5">
          <div className="h-[42px] flex items-center gap-2.5 px-3 border border-line-strong bg-elevated rounded-sm focus-within:border-white/30 transition-colors">
            <Search className="size-3.5 shrink-0 text-ghost" />
            <input
              className="flex-1 min-w-0 bg-transparent border-0 outline-none font-mono text-[14px] leading-5 text-fg placeholder:text-ghost"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('connections.filter')}
              autoFocus
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto border border-line rounded-sm bg-ink">
            {groups.length === 0 && (
              <div className="py-12 text-center font-sans text-[12px] leading-4 text-ghost">
                {hosts.length === 0 ? t('sidebar.emptyHosts') : t('sidebar.noMatch')}
              </div>
            )}
            {groups.map(([group, list]) => (
              <div key={group}>
                <button
                  data-connection-group
                  className="w-full h-8 px-3.5 flex items-center gap-2 border-b border-line text-left cursor-pointer hover:bg-white/[0.02]"
                  onClick={() => toggleGroup(group)}
                >
                  <ChevronRight
                    className={cn('size-3 text-faint transition-transform', !collapsedGroups.has(group) && 'rotate-90')}
                  />
                  <span className="font-mono text-[10px] leading-4 tracking-[0.08em] uppercase text-faint">
                    {group}
                  </span>
                  <span className="ml-auto font-mono text-[10px] leading-4 text-ghost">{list.length}</span>
                </button>
                {!collapsedGroups.has(group) &&
                  list.map((host) => {
                    const hasSession = sessionHostIds.has(host.id)
                    return (
                      <ContextMenu key={host.id}>
                        <ContextMenuTrigger asChild>
                          <button
                            data-connection-host
                            aria-describedby={host.description ? 'connection-host-description-tooltip' : undefined}
                            className={cn(
                              'w-full min-h-11 px-4 py-2 flex items-center gap-2.5 border-b border-white/[0.045] text-left cursor-pointer transition-colors',
                              'hover:bg-white/[0.03]',
                              activeHostId === host.id && 'bg-white/[0.045]'
                            )}
                            onMouseEnter={(event) => showDescription(event, host.description)}
                            onMouseLeave={hideDescription}
                            onFocus={(event) => showDescription(event, host.description)}
                            onBlur={hideDescription}
                            onClick={() => connect(host)}
                          >
                            <span className={cn('dot', hasSession && 'on')} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-[12px] leading-4 text-body truncate">
                                {host.label || `${host.username}@${host.host}`}
                              </span>
                              {host.description && (
                                <span className="block mt-0.5 font-sans text-[11px] leading-4 text-faint truncate">
                                  {host.description}
                                </span>
                              )}
                            </span>
                            <span className="max-w-[45%] font-mono text-[11px] leading-4 text-faint truncate">
                              {host.username}@{host.host}:{host.port}
                            </span>
                            <ChevronRight className="size-3 text-ghost" />
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onSelect={() => connect(host)}>{t('sidebar.menuConnect')}</ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => onAction(host, 'edit')}>{t('sidebar.menuEdit')}</ContextMenuItem>
                          <ContextMenuItem onSelect={() => onAction(host, 'duplicate')}>{t('sidebar.menuDuplicate')}</ContextMenuItem>
                          <ContextMenuItem onSelect={() => onAction(host, 'splitRight')}>{t('sidebar.menuSplitRight')}</ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={hasSession}
                            className="flex items-center gap-4 text-warn data-[highlighted]:text-warn"
                            onSelect={() => onAction(host, 'delete')}
                          >
                            <span>{t('sidebar.menuDelete')}</span>
                            {hasSession && (
                              <span className="ml-auto text-[10px] text-ghost">
                                {t('sidebar.menuDeleteDisabled')}
                              </span>
                            )}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    )
                  })}
              </div>
            ))}
          </div>
        </DialogBody>

        <div className="h-10 px-4 flex items-center border-t border-line shrink-0">
          <button
            className="flex items-center gap-1.5 font-mono text-[11px] leading-4 text-faint hover:text-body transition-colors cursor-pointer"
            onClick={() => {
              onOpenChange(false)
              onOpenCredentials()
            }}
          >
            <KeyRound className="size-3" />
            {t('creds.title')}
          </button>
          <span className="ml-auto font-sans text-[11px] leading-4 text-ghost">{t('connections.hint')}</span>
        </div>
      </DialogContent>
      {descriptionTooltip &&
        createPortal(
          <div
            id="connection-host-description-tooltip"
            role="tooltip"
            className="fixed z-[120] -translate-y-full w-max max-w-[min(360px,calc(100vw-32px))] px-2.5 py-1.5 border border-white/[0.14] rounded-sm bg-[#111] shadow-[0_8px_28px_rgba(0,0,0,0.55)] pointer-events-none font-sans text-[11px] leading-4 text-body whitespace-normal break-words"
            style={{ left: descriptionTooltip.left, top: descriptionTooltip.top }}
          >
            {descriptionTooltip.text}
          </div>,
          document.body
        )}
    </Dialog>
  )
}
