import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HostConfig, SessionStatus } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

/**
 * 会话信息栏：每个窗格顶部一条，左侧状态点 + user@host，右侧 SFTP 开关。
 */
interface SessionInfoBarProps {
  host: HostConfig
  status: SessionStatus
  sftpOpen: boolean
  onToggleSftp: () => void
  onHide: () => void
}

function dotClass(status: SessionStatus): string {
  switch (status) {
    case 'connected':
      return 'dot on'
    case 'connecting':
      return 'dot ing dot-ing'
    case 'error':
      return 'dot err'
    default:
      return 'dot'
  }
}

export function SessionInfoBar({ host, status, sftpOpen, onToggleSftp, onHide }: SessionInfoBarProps) {
  const { t } = useTranslation()
  const statusText: Record<SessionStatus, string> = {
    connecting: t('infoBar.connecting'),
    connected: t('infoBar.connected'),
    error: t('infoBar.error'),
    closed: t('infoBar.closed')
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-8 shrink-0 flex items-center justify-between pl-4 pr-2 border-b border-white/[0.06] bg-panel">
          <div className="flex items-center gap-2 min-w-0">
            <span className={dotClass(status)} />
            <span className="font-mono text-[11px] text-dim truncate">
              {host.username}@{host.host}:{host.port}
            </span>
            <span className="font-mono text-[10px] text-ghost shrink-0">{statusText[status]}</span>
          </div>
          <button
            className={cn('icon-btn', sftpOpen && '!text-fg bg-white/[0.06]')}
            title={t('infoBar.sftp')}
            onClick={onToggleSftp}
          >
            <FolderOpen className="size-3.5" />
            <span className="ml-1 font-mono text-[10px]">SFTP</span>
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onHide}>{t('infoBar.hide')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
