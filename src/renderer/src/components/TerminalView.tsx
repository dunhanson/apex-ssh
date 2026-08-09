import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ClipboardPaste } from 'lucide-react'
import type { HostConfig } from '@shared/types'
import { cn } from '@/lib/utils'
import { registerTerminal, unregisterTerminal } from '@/lib/terminals'
import { getSettingsSnapshot, useSettings } from '@/lib/settings'
import { getPasteMetrics, isMultilinePaste } from '@/lib/terminal-paste'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

/**
 * xterm.js 终端视图：一个会话一个实例。
 * 切换标签只显隐不销毁（保留回滚与终端状态）；onData → ssh:write，ssh:data → term.write。
 * autoConnect=false 用于独立窗口：先写入迁出快照再接续实时数据（连接由 attach 流程完成）。
 */
interface TerminalViewProps {
  sessionId: string
  host: HostConfig
  active: boolean
  /** 挂载时是否自动发起 SSH 连接（默认 true） */
  autoConnect?: boolean
  /** 迁移快照（含回滚），挂载时先于实时数据写入 */
  snapshot?: string
}

function copyText(text: string): void {
  const input = document.createElement('textarea')
  input.value = text
  input.style.cssText = 'position:fixed;left:-9999px;opacity:0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) void window.api.clipboard.writeText(text)
}

export function TerminalView({ sessionId, host, active, autoConnect = true, snapshot }: TerminalViewProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [pendingPaste, setPendingPaste] = useState<string | null>(null)
  const settings = useSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const requestPaste = (term: Terminal, text: string): void => {
    if (!text) {
      term.focus()
      return
    }
    if (settingsRef.current.confirmMultilinePaste && isMultilinePaste(text)) {
      setPendingPaste(text)
      return
    }
    term.paste(text)
    term.focus()
  }

  const pasteFromClipboard = async (term: Terminal): Promise<void> => {
    requestPaste(term, await window.api.clipboard.readText())
  }

  useEffect(() => {
    const initial = getSettingsSnapshot()
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: initial.fontSize,
      cursorStyle: initial.cursorStyle,
      cursorBlink: initial.cursorBlink,
      scrollback: initial.scrollback,
      scrollOnUserInput: initial.scrollOnInput,
      theme: {
        background: '#000000',
        foreground: '#e5e5e5',
        cursor: '#ffffff',
        selectionBackground: 'rgba(255, 255, 255, 0.15)'
      }
    })
    const fit = new FitAddon()
    const serialize = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(serialize)
    term.open(containerRef.current!)
    // xterm 的选区由自身维护；外层应用的 select-none 不应阻断终端拖选。
    containerRef.current!.style.userSelect = 'text'
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    registerTerminal(sessionId, { term, fit, serialize })

    // 迁出快照先落地（回滚 + 当前屏），实时数据随后追加
    if (snapshot) term.write(snapshot)

    // 键盘输入 → 主进程 ssh 通道
    term.onData((d) => window.api.ssh.write(sessionId, d))
    term.onSelectionChange(() => {
      const selected = term.hasSelection()
      setHasSelection(selected)
      if (selected && settingsRef.current.copyOnSelect) copyText(term.getSelection())
    })
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      if (event.ctrlKey && event.shiftKey && (event.code === 'KeyC' || key === 'c')) {
        event.preventDefault()
        if (term.hasSelection()) copyText(term.getSelection())
        return false
      }
      if (event.ctrlKey && event.shiftKey && (event.code === 'KeyV' || key === 'v')) {
        event.preventDefault()
        void pasteFromClipboard(term)
        return false
      }
      if (event.ctrlKey && event.shiftKey && (event.code === 'KeyA' || key === 'a')) {
        event.preventDefault()
        term.selectAll()
        return false
      }
      return true
    })
    const textarea = term.textarea
    const guardNativePaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text || !settingsRef.current.confirmMultilinePaste || !isMultilinePaste(text)) return
      event.preventDefault()
      requestPaste(term, text)
    }
    textarea?.addEventListener('paste', guardNativePaste)

    // ssh 输出 → 终端渲染（只收本会话的数据）
    const offData = window.api.ssh.onData((ev) => {
      if (ev.sessionId === sessionId) term.write(ev.data)
    })

    // 容器尺寸变化 → fit + 同步远端 pty 尺寸（隐藏时容器为 0，跳过）
    const container = containerRef.current!
    const ro = new ResizeObserver(() => {
      if (!container.isConnected || container.clientWidth === 0) return
      fit.fit()
      window.api.ssh.resize(sessionId, term.cols, term.rows)
    })
    ro.observe(container)

    // 带上初始尺寸发起连接
    if (autoConnect) {
      window.api.ssh.connect(sessionId, host, { cols: term.cols, rows: term.rows })
    }

    return () => {
      offData()
      ro.disconnect()
      textarea?.removeEventListener('paste', guardNativePaste)
      unregisterTerminal(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // sessionId/host 在标签生命周期内不变，仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 设置变更即时生效；字号变化后重新 fit，并同步远端尺寸。
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = settings.fontSize
    term.options.cursorStyle = settings.cursorStyle
    term.options.cursorBlink = settings.cursorBlink
    term.options.scrollback = settings.scrollback
    term.options.scrollOnUserInput = settings.scrollOnInput
    fitRef.current?.fit()
    window.api.ssh.resize(sessionId, term.cols, term.rows)
  }, [
    settings.fontSize,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.scrollback,
    settings.scrollOnInput,
    sessionId
  ])

  // 重新激活时：重新 fit（隐藏期间尺寸可能已变）并聚焦
  useEffect(() => {
    if (!active) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    fit.fit()
    window.api.ssh.resize(sessionId, term.cols, term.rows)
    term.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const copySelection = () => {
    const term = termRef.current
    if (term?.hasSelection()) copyText(term.getSelection())
  }

  const pasteSelection = () => {
    const term = termRef.current
    if (term) void pasteFromClipboard(term)
  }

  const pasteMetrics = getPasteMetrics(pendingPaste ?? '')

  const cancelPaste = () => {
    setPendingPaste(null)
    termRef.current?.focus()
  }

  const confirmPaste = () => {
    const term = termRef.current
    const text = pendingPaste
    setPendingPaste(null)
    if (term && text) term.paste(text)
    term?.focus()
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={containerRef}
            className={cn('terminal-instance select-text', !active && 'hidden')}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={!hasSelection} onSelect={copySelection}>
            {t('terminalMenu.copy')}
            <span className="ml-auto pl-6 text-ghost">Ctrl+Shift+C</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={pasteSelection}>
            {t('terminalMenu.paste')}
            <span className="ml-auto pl-6 text-ghost">Ctrl+Shift+V</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => termRef.current?.selectAll()}>
            {t('terminalMenu.selectAll')}
            <span className="ml-auto pl-6 text-ghost">Ctrl+Shift+A</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={pendingPaste !== null} onOpenChange={(open) => !open && cancelPaste()}>
        <DialogContent className="w-[480px] max-w-[calc(100vw-32px)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste aria-hidden="true" />
              {t('terminalMenu.multilinePasteTitle')}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3 font-mono text-[11px] leading-4 text-faint">
              <span>{t('terminalMenu.pasteLines', { count: pasteMetrics.lines })}</span>
              <span>{t('terminalMenu.pasteCharacters', { count: pasteMetrics.characters })}</span>
            </div>
            <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-line-strong bg-panel p-3 font-mono text-xs leading-[18px] text-body select-text">
              {pendingPaste}
            </pre>
          </DialogBody>
          <DialogFooter className="grid grid-cols-2">
            <Button className="w-full" onClick={cancelPaste}>
              {t('common.cancel')}
            </Button>
            <Button className="w-full" variant="solid" onClick={confirmPaste}>
              {t('terminalMenu.pasteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
