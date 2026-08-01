import { useSyncExternalStore } from 'react'
import type { TransferStatus } from '@shared/types'

/**
 * 传输队列store（模块级，跨组件/跨窗口实例共享当前窗口内的传输状态）。
 * 任务在面板关闭后继续跑——进度订阅挂在本模块，与面板生命周期无关。
 */
export interface TransferItem {
  taskId: string
  sessionId: string
  direction: 'up' | 'down'
  name: string
  transferred: number
  total: number
  status: TransferStatus
  message?: string
}

const items = new Map<string, TransferItem>()
const listeners = new Set<() => void>()
// 快照缓存：useSyncExternalStore 要求引用稳定，避免无限重渲染
let snapshot: TransferItem[] = []

function notify(): void {
  snapshot = [...items.values()]
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// 主进程进度事件 → 更新任务（模块加载即订阅，覆盖面板未打开的时期）
window.api.sftp.onProgress((ev) => {
  const item = items.get(ev.taskId)
  if (!item) return
  item.transferred = ev.transferred
  item.total = ev.total
  item.status = ev.status
  item.message = ev.message
  notify()
})

export function addTransfer(init: Omit<TransferItem, 'transferred' | 'status'>): void {
  items.set(init.taskId, { ...init, transferred: 0, status: 'running' })
  notify()
}

/** 移除任务：进行中的先取消 */
export function removeTransfer(taskId: string): void {
  const item = items.get(taskId)
  if (!item) return
  if (item.status === 'running' || item.status === 'paused') window.api.sftp.cancel(taskId)
  items.delete(taskId)
  notify()
}

export function clearCompleted(sessionId: string): void {
  for (const [id, item] of items) {
    if (item.sessionId === sessionId && item.status !== 'running' && item.status !== 'paused') {
      items.delete(id)
    }
  }
  notify()
}

/** 查询单个任务最新状态（非 hook，供轮询/判断用） */
export function getTransfer(taskId: string): TransferItem | undefined {
  return items.get(taskId)
}

export function useTransfers(sessionId: string): TransferItem[] {
  const all = useSyncExternalStore(subscribe, () => snapshot)
  return all.filter((t) => t.sessionId === sessionId)
}

// 开发环境暴露给 CDP 验收脚本（与 __terminals 同模式）
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__transfers = {
    add: addTransfer,
    remove: removeTransfer,
    clearCompleted,
    get: getTransfer,
    list: () => snapshot
  }
}
