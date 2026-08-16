import { PanelsTopLeft, Plus, Settings, SquareTerminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionStatus } from '@shared/types'
import { cn } from '@/lib/utils'
import { WinControls } from './WinControls'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

interface TabBase {
  sessionId: string
  title: string
  detail?: string
}

/** 工作区标签页数据（App 层维护） */
export type WorkspaceTab =
  | (TabBase & {
      kind: 'session'
      hostId: string
      status: SessionStatus
      sftpOpen: boolean
    })
  | (TabBase & { kind: 'blank' })
  | (TabBase & { kind: 'settings' })

/** 标签右键菜单动作 */
export type TabAction =
  | 'reconnect'
  | 'disconnect'
  | 'close'
  | 'closeOthers'
  | 'closeRight'
  | 'closeAll'
  | 'duplicate'
  | 'splitRight'
  | 'moveToWindow'
  | 'toggleSftp'

export type PaneSide = 'left' | 'right'

interface TabBarProps {
  leftTabs: WorkspaceTab[]
  /** null = 未分屏 */
  rightTabs: WorkspaceTab[] | null
  activeLeft: string | null
  activeRight: string | null
  focusSide: PaneSide
  /** 分屏比例（左窗格占比 0.2–0.8），标签栏与窗格同比例分半 */
  ratio: number
  onActivate: (side: PaneSide, sessionId: string) => void
  onClose: (side: PaneSide, sessionId: string) => void
  onNew?: (side: PaneSide) => void
  onOpenConnections?: () => void
  onOpenSettings?: () => void
  onAction: (side: PaneSide, sessionId: string, action: TabAction) => void
}

function statusIconClass(status?: SessionStatus, active?: boolean): string {
  switch (status) {
    case 'connected':
      return active ? 'text-fg' : 'text-dim'
    case 'connecting':
      return 'text-warn dot-ing'
    case 'error':
      return 'text-danger'
    default:
      return active ? 'text-fg' : 'text-faint'
  }
}

interface TabProps {
  tab: WorkspaceTab
  side: PaneSide
  active: boolean
  isLast: boolean
  onActivate: () => void
  onClose: () => void
  onAction: (action: TabAction) => void
}

function Tab({ tab, side, active, isLast, onActivate, onClose, onAction }: TabProps) {
  const { t } = useTranslation()
  // 断开/失败后标签保留：删除线标识，可重连恢复
  const dead = tab.kind === 'session' && (tab.status === 'closed' || tab.status === 'error')
  const content = (
    <div
      role="tab"
      aria-selected={active}
      data-tab-id={tab.sessionId}
      data-workspace-tab
      data-session-tab={tab.kind === 'session' ? '' : undefined}
      data-tab-kind={tab.kind}
      data-status={tab.kind === 'session' ? tab.status : tab.kind}
      title={tab.detail}
      tabIndex={active ? 0 : -1}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onActivate()
      }}
      className={cn(
        'app-no-drag flex items-center gap-[7px] pl-3 pr-2 cursor-pointer min-w-[120px] max-w-[180px] shrink-0',
        'border-r border-white/[0.04] border-b border-b-transparent -mb-px transition-colors duration-100 group',
        active ? 'bg-ink border-b-white' : 'hover:bg-white/[0.02]'
      )}
    >
      {tab.kind === 'settings' ? (
        <Settings className={cn('size-3 shrink-0', active ? 'text-fg' : 'text-faint')} strokeWidth={1.5} />
      ) : (
        <SquareTerminal
          className={cn(
            'size-3 shrink-0',
            statusIconClass(tab.kind === 'session' ? tab.status : undefined, active)
          )}
          strokeWidth={1.5}
        />
      )}
      <span
        className={cn(
          'flex-1 truncate font-mono text-[12px] leading-4',
          active ? 'text-fg' : 'text-dim',
          dead && 'line-through decoration-white/30'
        )}
      >
        {tab.title}
      </span>
      <button
        className={cn(
          'icon-btn !p-0.5 transition-opacity',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        title={t('tabMenu.close')}
        aria-label={t('tabMenu.close')}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  )

  if (tab.kind !== 'session') return content

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onAction('reconnect')}>{t('tabMenu.reconnect')}</ContextMenuItem>
        <ContextMenuItem disabled={tab.status === 'closed'} onSelect={() => onAction('disconnect')}>
          {t('tabMenu.disconnect')}
        </ContextMenuItem>
        <ContextMenuItem disabled={tab.status !== 'connected'} onSelect={() => onAction('toggleSftp')}>
          {t(tab.sftpOpen ? 'tabMenu.closeSftp' : 'tabMenu.openSftp')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onAction('close')}>{t('tabMenu.close')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction('closeOthers')}>{t('tabMenu.closeOthers')}</ContextMenuItem>
        <ContextMenuItem disabled={isLast} onSelect={() => onAction('closeRight')}>
          {t('tabMenu.closeRight')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction('closeAll')}>{t('tabMenu.closeAll')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onAction('duplicate')}>{t('tabMenu.duplicate')}</ContextMenuItem>
        {side === 'left' && (
          <ContextMenuItem onSelect={() => onAction('splitRight')}>{t('tabMenu.splitRight')}</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => onAction('moveToWindow')}>{t('tabMenu.moveToWindow')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface TabGroupProps {
  side: PaneSide
  tabs: WorkspaceTab[]
  activeId: string | null
  onActivate: (side: PaneSide, sessionId: string) => void
  onClose: (side: PaneSide, sessionId: string) => void
  onNew?: (side: PaneSide) => void
  onOpenConnections?: () => void
  showConnections: boolean
  onAction: (side: PaneSide, sessionId: string, action: TabAction) => void
}

function TabGroup({
  side,
  tabs,
  activeId,
  onActivate,
  onClose,
  onNew,
  onOpenConnections,
  showConnections,
  onAction
}: TabGroupProps) {
  const { t } = useTranslation()
  return (
    <>
      {tabs.map((tab, i) => (
        <Tab
          key={tab.sessionId}
          tab={tab}
          side={side}
          active={tab.sessionId === activeId}
          isLast={i === tabs.length - 1}
          onActivate={() => onActivate(side, tab.sessionId)}
          onClose={() => onClose(side, tab.sessionId)}
          onAction={(action) => onAction(side, tab.sessionId, action)}
        />
      ))}
      {tabs.length > 0 && onNew && (
        <div className="app-no-drag flex items-stretch shrink-0">
          <button
            className="tab-tool"
            title={t('tabs.newTab')}
            aria-label={t('tabs.newTab')}
            onClick={() => onNew(side)}
          >
            <Plus className="size-3.5" />
          </button>
          {showConnections && onOpenConnections && (
            <button
              className="tab-tool"
              title={t('connections.title')}
              aria-label={t('connections.title')}
              onClick={onOpenConnections}
            >
              <PanelsTopLeft className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {/* 拖拽空白区：拖动移动窗口，双击切换最大化 */}
      <div className="flex-1" onDoubleClick={() => window.api.window.toggleMaximize()} />
    </>
  )
}

/** 标签栏：42px 高；分屏时左右两组与窗格同比例分半，右侧最末为设置与自绘窗口三键。 */
export function TabBar({
  leftTabs,
  rightTabs,
  activeLeft,
  activeRight,
  focusSide,
  ratio,
  onActivate,
  onClose,
  onNew,
  onOpenConnections,
  onOpenSettings,
  onAction
}: TabBarProps) {
  const { t } = useTranslation()
  const split = rightTabs !== null
  const settingsActive = leftTabs.some(
    (tab) => tab.kind === 'settings' && tab.sessionId === activeLeft
  )
  return (
    <div data-tab-bar className="app-drag h-[42px] shrink-0 flex items-stretch bg-panel border-b border-white/[0.06]">
      <div
        className="flex items-stretch min-w-0 overflow-hidden"
        style={{ width: split ? `${ratio * 100}%` : '100%' }}
      >
        <TabGroup
          side="left"
          tabs={leftTabs}
          activeId={activeLeft}
          onActivate={onActivate}
          onClose={onClose}
          onNew={onNew}
          onOpenConnections={onOpenConnections}
          showConnections
          onAction={onAction}
        />
      </div>
      {split && (
        <div
          className={cn(
            'flex-1 flex items-stretch min-w-0 overflow-hidden border-l border-white/[0.06]',
            focusSide === 'right' && 'bg-white/[0.01]'
          )}
        >
          <TabGroup
            side="right"
            tabs={rightTabs}
            activeId={activeRight}
            onActivate={onActivate}
            onClose={onClose}
            onNew={onNew}
            onOpenConnections={onOpenConnections}
            showConnections={false}
            onAction={onAction}
          />
        </div>
      )}
      {onOpenSettings && (
        <button
          className={cn('app-no-drag tab-tool shrink-0', settingsActive && 'bg-white/[0.05] text-fg')}
          title={t('settings.title')}
          aria-label={t('settings.title')}
          aria-pressed={settingsActive}
          onClick={onOpenSettings}
        >
          <Settings className="size-3.5" />
        </button>
      )}
      <WinControls />
    </div>
  )
}
