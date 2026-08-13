import type { SshExecResult } from '@shared/types'

/**
 * 主机资源监控：一次性采集脚本与解析/计算工具。
 * 所有命令均通过主进程 ssh:exec 在已有连接上执行，不安装远端服务。
 */

export interface MonitorSample {
  timestamp: number
  cpu: number // 0-1
  memory: number // 0-1
  disk: number // 0-1
  rx: number // bytes/s
  tx: number // bytes/s
}

export interface HostInfo {
  os: string
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  memoryTotal: number // bytes
  diskTotal: number // bytes
  netIface: string
  netIfaces: string[]
  netSpeed?: number // Mb/s
}

export interface RawSample {
  timestamp: number
  cpuTotal: number
  cpuIdle: number
  memTotal: number
  memAvail: number
  diskTotal: number
  diskUsed: number
  netIface: string
  netRx: number
  netTx: number
}

/** 采集 CPU/内存/磁盘/网络的原始计数器（Linux only） */
export const MONITOR_COLLECT_CMD = (iface: string): string => `{
  read -r _ user nice system idle _ _ _ _ _ < /proc/stat
  echo "cpu_total=$((user+nice+system+idle))"
  echo "cpu_idle=$idle"
  awk '/MemTotal/{mt=$2} /MemAvailable/{ma=$2} END{print "mem_total=" mt*1024; print "mem_avail=" ma*1024}' /proc/meminfo
  df -k / | awk 'NR==2{print "disk_total=" $2*1024; print "disk_used=" $3*1024}'
  awk 'NR>2 && $1!="lo:"{gsub(/:/,"",$1); if($1=="${iface}"){print "net_iface=" $1; print "net_rx=" $2; print "net_tx=" $10; exit}}' /proc/net/dev
}`

/** 采集主机静态配置（面板打开时执行一次） */
export const HOST_INFO_CMD = `{
  uname -s | awk '{print "os=" $1}'
  awk -F: '/^model name/{gsub(/^[ \t]+/,"",$2); if(!m) m=$2} /^processor/{p++} /^core id/{c[$2]=1} /^cpu cores/{gsub(/^[ \t]+/,"",$2); cc=$2} END{print "cpu_model=" m; print "cpu_threads=" p; print "cpu_cores=" (cc?cc:length(c))}' /proc/cpuinfo
  awk '/MemTotal/{print "mem_total=" $2*1024}' /proc/meminfo
  df -k / | awk 'NR==2{print "disk_total=" $2*1024}'
  awk 'NR>2 && $1!="lo:"{gsub(/:/,"",$1); a[n++]=$1} END{printf "net_ifaces="; for(i=0;i<n;i++){printf "%s%s", a[i], (i<n-1?",":"")}; print ""}' /proc/net/dev
}`

/** 读取网卡链路速率（Mb/s），失败返回 undefined */
const NET_SPEED_CMD = (iface: string): string =>
  `{ v=$(cat /sys/class/net/${iface}/speed 2>/dev/null); [ -n "$v" ] && [ "$v" -gt 0 ] 2>/dev/null && { echo "$v"; exit; }; ethtool ${iface} 2>/dev/null | awk '/Speed:/{gsub(/[^0-9]/,"",$2); if($2+0>0) print $2}'; }`

export async function readNetSpeed(
  exec: (command: string) => Promise<SshExecResult>,
  iface: string
): Promise<number | undefined> {
  try {
    const speedRes = await exec(NET_SPEED_CMD(iface))
    if (speedRes.code === 0) {
      const speed = Number(speedRes.stdout.trim())
      if (Number.isFinite(speed) && speed > 0) return speed
    }
  } catch {
    // 忽略网卡速率读取失败
  }
  return undefined
}

/** 解析 "key=value" 文本为对象 */
function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.includes('=') === false) continue
    const idx = trimmed.indexOf('=')
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
  }
  return out
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** 解析 exec 返回的原始采样 */
export function parseCollect(result: SshExecResult): Partial<RawSample> {
  if (result.code !== 0) {
    throw new Error(result.stderr || `监控采集失败 (code ${result.code ?? '?'})`)
  }
  const kv = parseKeyValue(result.stdout)
  return {
    cpuTotal: parseNumber(kv.cpu_total),
    cpuIdle: parseNumber(kv.cpu_idle),
    memTotal: parseNumber(kv.mem_total),
    memAvail: parseNumber(kv.mem_avail),
    diskTotal: parseNumber(kv.disk_total),
    diskUsed: parseNumber(kv.disk_used),
    netIface: kv.net_iface,
    netRx: parseNumber(kv.net_rx),
    netTx: parseNumber(kv.net_tx)
  }
}

/** 解析主机静态信息 */
export async function parseHostInfo(
  exec: (command: string) => Promise<SshExecResult>,
  result: SshExecResult
): Promise<HostInfo> {
  if (result.code !== 0) {
    throw new Error(result.stderr || `主机信息采集失败 (code ${result.code ?? '?'})`)
  }
  const kv = parseKeyValue(result.stdout)
  const ifaces = kv.net_ifaces?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  const iface = pickDefaultIface(ifaces)
  let netSpeed: number | undefined
  if (iface) {
    netSpeed = await readNetSpeed(exec, iface)
  }
  return {
    os: kv.os ?? 'Linux',
    cpuModel: kv.cpu_model ?? '',
    cpuCores: parseNumber(kv.cpu_cores) ?? 0,
    cpuThreads: parseNumber(kv.cpu_threads) ?? 0,
    memoryTotal: parseNumber(kv.mem_total) ?? 0,
    diskTotal: parseNumber(kv.disk_total) ?? 0,
    netIface: iface,
    netIfaces: ifaces,
    netSpeed
  }
}

/** 按优先级选择默认网卡：eth* > en* > 其他 */
export function pickDefaultIface(ifaces: string[]): string {
  if (ifaces.length === 0) return ''
  const eth = ifaces.find((i) => i.startsWith('eth'))
  if (eth) return eth
  const en = ifaces.find((i) => i.startsWith('en'))
  if (en) return en
  return ifaces[0]
}

/** 由两次原始采样计算得到使用率/速率 */
export function computeSample(
  prev: RawSample | undefined,
  curr: RawSample,
  intervalSec: number
): MonitorSample {
  const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0)

  let cpu = 0
  if (prev) {
    const totalDelta = curr.cpuTotal - prev.cpuTotal
    const idleDelta = curr.cpuIdle - prev.cpuIdle
    cpu = totalDelta > 0 ? safeDiv(totalDelta - idleDelta, totalDelta) : 0
  }

  const memory = safeDiv((curr.memTotal ?? 0) - (curr.memAvail ?? 0), curr.memTotal ?? 1)
  const disk = safeDiv(curr.diskUsed ?? 0, curr.diskTotal ?? 1)

  let rx = 0
  let tx = 0
  if (prev && prev.netIface === curr.netIface && intervalSec > 0) {
    rx = Math.max(0, (curr.netRx - prev.netRx) / intervalSec)
    tx = Math.max(0, (curr.netTx - prev.netTx) / intervalSec)
  }

  return {
    timestamp: curr.timestamp,
    cpu: Math.min(1, Math.max(0, cpu)),
    memory: Math.min(1, Math.max(0, memory)),
    disk: Math.min(1, Math.max(0, disk)),
    rx,
    tx
  }
}

/** 格式化字节为 KB/MB/GB */
export function fmtBytes(bytes: number): string {
  const abs = Math.abs(bytes)
  if (abs >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (abs >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** 格式化字节/秒为 B/s / KB/s / MB/s */
export function fmtBytesPerSec(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(2)} MB/s`
  if (abs >= 1024) return `${(v / 1024).toFixed(1)} KB/s`
  return `${v.toFixed(0)} B/s`
}

/** 格式化链路速率为 bps/Kbps/Mbps/Gbps */
export function fmtNetSpeed(bps: number | undefined): string {
  if (bps === undefined || bps <= 0) return ''
  if (bps >= 1000 * 1000 * 1000) return `${(bps / 1000 / 1000 / 1000).toFixed(0)} Gbps`
  if (bps >= 1000 * 1000) return `${(bps / 1000 / 1000).toFixed(0)} Mbps`
  if (bps >= 1000) return `${(bps / 1000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bps`
}

/** 格式化百分比 0-1 → xx.x% */
export function fmtPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

/** 计算 15 分钟窗口内的最大采样点数 */
export function getMaxPoints(intervalSec: number): number {
  return Math.ceil((15 * 60) / Math.max(1, intervalSec))
}
