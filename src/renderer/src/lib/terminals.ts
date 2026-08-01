import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SerializeAddon } from '@xterm/addon-serialize'

/**
 * 会话 id → xterm 实例注册表。
 * App 层的会话操作（重连取终端尺寸、「移到新窗口」取 serialize 快照）需要拿到终端实例。
 */
export interface TermHandle {
  term: Terminal
  fit: FitAddon
  serialize: SerializeAddon
}

const registry = new Map<string, TermHandle>()

// 验收脚本用：CDP 键事件在被遮挡的窗口里落不到页面，脚本改走 window.api.ssh.write 注入输入
if (import.meta.env.DEV) {
  ;(window as unknown as { __terminals: Map<string, TermHandle> }).__terminals = registry
}

export function registerTerminal(sessionId: string, handle: TermHandle): void {
  registry.set(sessionId, handle)
}

export function unregisterTerminal(sessionId: string): void {
  registry.delete(sessionId)
}

export function getTerminal(sessionId: string): TermHandle | undefined {
  return registry.get(sessionId)
}
