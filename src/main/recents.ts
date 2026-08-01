import Store from 'electron-store'
import type { HostConfig, RecentEntry } from '@shared/types'

/**
 * 最近使用记录持久化：连接成功时由 ssh 模块写入，按时间倒序，最多 50 条。
 * 同一主机重复连接只保留最新一条。
 */
const MAX_ENTRIES = 50

const store = new Store<{ recents: RecentEntry[] }>({
  // conf 无法从 CJS 主进程推断包名，需显式指定；electron-store v11 类型定义未暴露该字段，运行时有效
  // @ts-expect-error projectName 在 conf v15 运行时有效
  projectName: 'apex-ssh',
  name: 'apex-config',
  defaults: { recents: [] }
})

export function listRecents(): RecentEntry[] {
  return store.get('recents')
}

/** 连接成功时记录（host 为完整主机配置，取展示所需字段） */
export function addRecent(host: HostConfig): void {
  const entry: RecentEntry = {
    hostId: host.id,
    label: host.label,
    host: host.host,
    port: host.port,
    username: host.username,
    connectedAt: Date.now()
  }
  const rest = listRecents().filter((r) => r.hostId !== host.id)
  store.set('recents', [entry, ...rest].slice(0, MAX_ENTRIES))
}

export function removeRecent(hostId: string): void {
  store.set(
    'recents',
    listRecents().filter((r) => r.hostId !== hostId)
  )
}

export function clearRecents(): void {
  store.set('recents', [])
}
