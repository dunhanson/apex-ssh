import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshConfigEntry } from '@shared/types'

/**
 * ~/.ssh/config 解析（一次性导入用，不与原文件同步）。
 * 简化实现：Host 块分段；含通配符（* / ?）的块只作默认值合并不生成条目；
 * 只提取 HostName / User / Port / IdentityFile / ProxyJump / ProxyCommand，其余指令忽略。
 */
interface Block {
  patterns: string[]
  options: Map<string, string>
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    // 去掉行内注释与首尾空白（引号场景简化处理，覆盖常规写法）
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\S+)\s+(.+)$/)
    if (!m) continue
    const keyword = m[1].toLowerCase()
    const value = m[2].trim()
    if (keyword === 'host') {
      current = { patterns: value.split(/\s+/), options: new Map() }
      blocks.push(current)
    } else if (current) {
      // ssh 语义：同一关键字先出现的生效，重复出现只记第一次
      if (!current.options.has(keyword)) current.options.set(keyword, value)
    }
  }
  return blocks
}

const isWildcard = (pattern: string): boolean => pattern.includes('*') || pattern.includes('?')

/** 展开路径开头的 ~ 为 home 目录 */
function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

export function listSshConfig(): SshConfigEntry[] {
  // APEX_SSH_CONFIG 可覆盖解析路径（验收脚本用夹具文件，避免触碰真实配置）
  const file = process.env.APEX_SSH_CONFIG || join(homedir(), '.ssh', 'config')
  if (!existsSync(file)) return []
  const blocks = parseBlocks(readFileSync(file, 'utf8'))

  // 通配块作为默认值来源（按文件顺序，先出现的关键字优先）
  const defaults = new Map<string, string>()
  for (const b of blocks) {
    if (!b.patterns.every(isWildcard)) continue
    for (const [k, v] of b.options) {
      if (!defaults.has(k)) defaults.set(k, v)
    }
  }

  const entries: SshConfigEntry[] = []
  for (const b of blocks) {
    for (const pattern of b.patterns) {
      if (isWildcard(pattern)) continue
      const get = (key: string): string | undefined =>
        b.options.get(key) ?? defaults.get(key)
      const port = Number(get('port'))
      entries.push({
        alias: pattern,
        hostname: get('hostname'),
        user: get('user'),
        port: Number.isInteger(port) && port > 0 ? port : undefined,
        identityFile: get('identityfile') ? expandHome(get('identityfile')!) : undefined,
        hasProxy: b.options.has('proxyjump') || b.options.has('proxycommand')
      })
    }
  }
  return entries
}
