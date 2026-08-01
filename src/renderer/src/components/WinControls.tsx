import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * frameless 窗口的自绘三键，样式对齐原型（40px 宽、#666 图标、
 * 最小化/最大化 hover 白底 8%，关闭 hover #c42b1c）；
 * 最大化时切换为「还原」图标，状态经 window:* IPC 与主进程同步。
 */
export function WinControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizedChange(setMaximized)
  }, [])

  return (
    <div className="app-no-drag flex items-stretch shrink-0">
      <button
        className="win-btn"
        title="最小化"
        onClick={() => window.api.window.minimize()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 12h14" />
        </svg>
      </button>
      <button
        className="win-btn"
        title={maximized ? '还原' : '最大化'}
        onClick={() => window.api.window.toggleMaximize()}
      >
        {maximized ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect width="13" height="13" x="8" y="8" rx="1" />
            <path d="M16 4H5a1 1 0 0 0-1 1v11" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect width="16" height="16" x="4" y="4" rx="1" />
          </svg>
        )}
      </button>
      <button
        className={cn('win-btn win-close')}
        title="关闭"
        onClick={() => window.api.window.close()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  )
}
