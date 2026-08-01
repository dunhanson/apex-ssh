import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetachedSessionInfo, SessionStatus } from '@shared/types'
import { TabBar } from '@/components/TabBar'
import { TerminalView } from '@/components/TerminalView'
import { SessionInfoBar } from '@/components/SessionInfoBar'
import { SftpPanel } from '@/components/SftpPanel'
import { Toaster } from '@/components/ui/sonner'
import { setSettings, useSettings } from '@/lib/settings'

/**
 * 独立会话窗口（「移到新窗口」）：?detached=<sessionId> 进入。
 * attach 接管会话数据流并拿到终端快照，先写快照再接续实时数据——
 * 迁移过程中 SSH 通道不断开、终端历史不丢失。窗口关闭即断开该会话（主进程负责）。
 */
interface DetachedAppProps {
  sessionId: string
}

export default function DetachedApp({ sessionId }: DetachedAppProps) {
  const { t } = useTranslation()
  const settings = useSettings()
  const [info, setInfo] = useState<DetachedSessionInfo | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [missing, setMissing] = useState(false)
  const [sftpOpen, setSftpOpen] = useState(false)

  useEffect(() => {
    window.api.session.attach(sessionId).then((res) => {
      if (!res) {
        setMissing(true)
        return
      }
      setInfo(res)
      setStatus('connected')
    })
  }, [sessionId])

  // 跟踪会话状态（远端 exit / 断线都会体现在信息栏与标签上）
  useEffect(() => {
    return window.api.ssh.onStatus((ev) => {
      if (ev.sessionId !== sessionId) return
      setStatus(ev.status)
      if (ev.status === 'error') toast.error(t('toast.connectFailed', { message: ev.message ?? t('common.unknown') }))
    })
  }, [sessionId])

  if (missing) {
    return (
      <div className="h-full flex items-center justify-center bg-ink">
        <span className="font-mono text-[12px] text-faint">{t('detached.missing')}</span>
      </div>
    )
  }

  const title = info ? info.host.label || `${info.host.username}@${info.host.host}` : sessionId

  return (
    <div className="h-full flex flex-col overflow-hidden select-none bg-ink">
      <TabBar
        leftTabs={[
          {
            kind: 'session',
            sessionId,
            hostId: info?.host.id ?? '',
            title,
            detail: info ? `${info.host.username}@${info.host.host}:${info.host.port} · ${t(`infoBar.${status}`)}` : undefined,
            status,
            sftpOpen
          }
        ]}
        rightTabs={null}
        activeLeft={sessionId}
        activeRight={null}
        focusSide="left"
        ratio={1}
        onActivate={() => {}}
        onClose={() => window.api.window.close()}
        onAction={(_side, _id, action) => {
          if (action === 'toggleSftp' && status === 'connected') {
            setSftpOpen((value) => !value)
            return
          }
          if (action === 'close' || action === 'closeAll' || action === 'disconnect') {
            window.api.window.close()
          }
        }}
      />
      {settings.showSessionInfoBar && info && (
        <SessionInfoBar
          host={info.host}
          status={status}
          sftpOpen={sftpOpen}
          onToggleSftp={() => setSftpOpen((v) => !v)}
          onHide={() => setSettings({ showSessionInfoBar: false })}
        />
      )}
      <div className="relative flex-1 min-h-0">
        {info && (
          <TerminalView
            sessionId={sessionId}
            host={info.host}
            active
            autoConnect={false}
            snapshot={info.snapshot}
          />
        )}
      </div>
      {info && sftpOpen && status === 'connected' && (
        <SftpPanel sessionId={sessionId} onClose={() => setSftpOpen(false)} />
      )}
      <Toaster />
    </div>
  )
}
