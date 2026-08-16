import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Pause, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings, setSettings } from '@/lib/settings'
import { fmtBytes, fmtBytesPerSec, fmtNetSpeed, fmtPercent, type HostInfo, type MonitorSample } from '@/lib/monitor'
import type { MonitorSessionState } from '@/lib/useBackgroundMonitor'

interface MonitorPanelProps {
  sessionId: string
  state: MonitorSessionState
  onClose: () => void
  onTogglePause: () => void
  onChangeIface: (iface: string) => void
}

const COLORS = {
  cpu: '#3987e5',
  memory: '#199e70',
  disk: '#c98500',
  rx: '#d95926',
  tx: '#d55181',
  grid: 'rgba(255,255,255,0.06)'
}

export function MonitorPanel({ sessionId, state, onClose, onTogglePause, onChangeIface }: MonitorPanelProps) {
  const { t } = useTranslation()
  const settings = useSettings()
  const [height, setHeight] = useState(240)
  const [hoverIndex, setHoverIndex] = useState(-1)

  const intervalSec = Math.max(1, Math.min(60, settings.monitorRefreshInterval))
  const { samples, hostInfo, selectedIface, loading, error, paused } = state
  const isLinux = hostInfo?.os.toLowerCase() === 'linux'
  const last = samples[samples.length - 1]

  const startHeightDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const onMove = (ev: MouseEvent) => {
      const next = startHeight + (startY - ev.clientY)
      setHeight(Math.min(window.innerHeight * 0.8, Math.max(120, next)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="shrink-0 flex flex-col border-t border-white/[0.06] bg-panel" style={{ height }}>
      {/* 高度拖拽条 */}
      <div
        className="h-[5px] -mt-[3px] shrink-0 cursor-row-resize relative z-10 hover:bg-white/[0.08] transition-colors"
        onMouseDown={startHeightDrag}
        title={t('monitor.dragHeight')}
      />

      {/* 工具栏 */}
      <div className="h-9 shrink-0 flex items-center gap-1.5 px-2.5 border-b border-white/[0.06]">
        <Activity className="size-3.5 text-dim" />
        <span className="font-mono text-[12px] text-body">{t('monitor.title')}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] font-mono text-dim">
          {t('monitor.refreshInterval')}
          <select
            className="bg-surface border border-line rounded-sm px-1.5 py-0.5 text-body outline-none focus:border-white/20"
            value={intervalSec}
            onChange={(e) => setSettings({ monitorRefreshInterval: Number(e.target.value) })}
          >
            <option value={5}>{t('monitor.seconds', { count: 5 })}</option>
            <option value={10}>{t('monitor.seconds', { count: 10 })}</option>
            <option value={30}>{t('monitor.seconds', { count: 30 })}</option>
            <option value={60}>{t('monitor.seconds', { count: 60 })}</option>
          </select>
        </label>
        <button
          className="icon-btn flex items-center gap-1 px-1.5"
          title={paused ? t('monitor.resume') : t('monitor.pause')}
          onClick={onTogglePause}
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          <span className="font-mono text-[10px]">{paused ? t('monitor.resume') : t('monitor.pause')}</span>
        </button>
        <button className="icon-btn" title={t('monitor.close')} onClick={onClose}>
          <X className="size-3.5" />
        </button>
      </div>

      {/* 主体 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <div className="h-full flex items-center justify-center text-faint font-mono text-[12px]">
            {t('monitor.loading')}
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-danger font-mono text-[12px]">
            {error}
          </div>
        ) : !isLinux ? (
          <div className="h-full flex flex-col items-center justify-center text-faint">
            <Activity className="size-8 mb-2 text-ghost" />
            <span className="font-mono text-[12px]">{t('monitor.linuxOnly')}</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[560px]:grid-cols-1">
              <MetricCard
                name={t('monitor.cpu')}
                color={COLORS.cpu}
                samples={samples}
                dataKey="cpu"
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                mainValue={last ? fmtPercent(last.cpu) : '--'}
                subtitle={hostInfo?.cpuModel}
                detailLeft={hostInfo ? `${hostInfo.cpuCores} ${t('monitor.cores')}` : ''}
                detailRight={hostInfo ? `${hostInfo.cpuThreads} ${t('monitor.threads')}` : ''}
              />
              <MetricCard
                name={t('monitor.memory')}
                color={COLORS.memory}
                samples={samples}
                dataKey="memory"
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                mainValue={last ? fmtPercent(last.memory) : '--'}
                subtitle={hostInfo?.memoryTotal ? fmtBytes(hostInfo.memoryTotal) : undefined}
                detailLeft={
                  last && hostInfo
                    ? `${t('monitor.used')} ${fmtBytes(last.memory * hostInfo.memoryTotal)}`
                    : ''
                }
                detailRight={
                  last && hostInfo
                    ? `${t('monitor.available')} ${fmtBytes((1 - last.memory) * hostInfo.memoryTotal)}`
                    : ''
                }
              />
              <MetricCard
                name={t('monitor.disk')}
                color={COLORS.disk}
                samples={samples}
                dataKey="disk"
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                mainValue={last ? fmtPercent(last.disk) : '--'}
                subtitle={hostInfo?.diskTotal ? fmtBytes(hostInfo.diskTotal) : undefined}
                detailLeft={
                  last && hostInfo
                    ? `${t('monitor.used')} ${fmtBytes(last.disk * hostInfo.diskTotal)}`
                    : ''
                }
                detailRight={
                  last && hostInfo
                    ? `${t('monitor.available')} ${fmtBytes((1 - last.disk) * hostInfo.diskTotal)}`
                    : ''
                }
              />
              <NetworkCard
                samples={samples}
                hostInfo={hostInfo}
                selectedIface={selectedIface}
                ifaces={hostInfo?.netIfaces ?? []}
                onChange={onChangeIface}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                t={t}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface MetricCardProps {
  name: string
  subtitle?: string
  color: string
  samples: MonitorSample[]
  dataKey: 'cpu' | 'memory' | 'disk'
  hoverIndex: number
  onHover: (idx: number) => void
  mainValue: string
  detailLeft: string
  detailRight: string
}

function MetricCard({
  name,
  subtitle,
  color,
  samples,
  dataKey,
  hoverIndex,
  onHover,
  mainValue,
  detailLeft,
  detailRight
}: MetricCardProps) {
  return (
    <div className="min-h-[148px] p-3 pb-2 rounded-sm border border-white/[0.06] bg-[#0a0a0a] flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[12px] text-dim">{name}</span>
          {subtitle && (
            <div className="font-mono text-[10px] leading-4 text-dim truncate" title={subtitle}>
              {subtitle}
            </div>
          )}
        </div>
        <span className="font-mono text-[22px] leading-7 font-medium text-fg shrink-0">{mainValue}</span>
      </div>
      <div className="flex items-center justify-between font-mono text-[11px] leading-4 text-faint">
        <span className="truncate">{detailLeft}</span>
        <span className="truncate">{detailRight}</span>
      </div>
      <div className="flex-1 min-h-[60px] relative">
        <MetricChart
          samples={samples}
          value={(s) => s[dataKey]}
          color={color}
          hoverIndex={hoverIndex}
          onHover={onHover}
          tooltip={(s) => `${name} ${fmtPercent(s[dataKey])}`}
        />
      </div>
    </div>
  )
}

function NetworkCard({
  samples,
  hostInfo,
  selectedIface,
  ifaces,
  onChange,
  hoverIndex,
  onHover,
  t
}: {
  samples: MonitorSample[]
  hostInfo: HostInfo | null
  selectedIface: string
  ifaces: string[]
  onChange: (iface: string) => void
  hoverIndex: number
  onHover: (idx: number) => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const last = samples[samples.length - 1]
  const speedText = hostInfo?.netSpeed ? fmtNetSpeed(hostInfo.netSpeed * 1000000) : ''
  const [editing, setEditing] = useState(false)
  const canSwitch = ifaces.length > 1
  const ifaceLabel = speedText ? `${selectedIface} · ${speedText}` : selectedIface

  return (
    <div className="min-h-[148px] p-3 pb-2 rounded-sm border border-white/[0.06] bg-[#0a0a0a] flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[12px] text-dim">{t('monitor.network')}</span>
            {editing && canSwitch ? (
              <select
                autoFocus
                className="bg-surface border border-line rounded-sm px-1 py-0 text-[10px] font-mono text-body outline-none focus:border-white/20"
                value={selectedIface}
                onChange={(e) => {
                  onChange(e.target.value)
                  setEditing(false)
                }}
                onBlur={() => setEditing(false)}
                title={t('monitor.doubleClickToSwitch')}
              >
                {ifaces.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className={cn(
                  'font-mono text-[10px] leading-4 text-dim',
                  canSwitch && 'cursor-pointer hover:text-body'
                )}
                title={canSwitch ? t('monitor.doubleClickToSwitch') : ''}
                tabIndex={canSwitch ? 0 : undefined}
                onDoubleClick={() => canSwitch && setEditing(true)}
              >
                {ifaceLabel || '--'}
              </span>
            )}
          </div>
        </div>
        <span className="font-mono text-[16px] leading-6 font-medium text-fg shrink-0">
          {last ? `${t('monitor.rx')} ${fmtBytesPerSec(last.rx)}` : '--'}
        </span>
      </div>
      <div className="flex items-center justify-between font-mono text-[11px] leading-4 text-faint">
        <span className="truncate" />
        <span className="truncate">
          {last ? `${t('monitor.tx')} ${fmtBytesPerSec(last.tx)}` : ''}
        </span>
      </div>
      <div className="flex-1 min-h-[60px] relative">
        <div className="absolute top-0 right-0 z-5 flex items-center gap-2.5 font-mono text-[10px] text-faint bg-[rgba(8,8,8,0.7)] px-1 py-0.5 rounded-sm">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: COLORS.rx }} />
            {t('monitor.rx')}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: COLORS.tx }} />
            {t('monitor.tx')}
          </span>
        </div>
        <MetricChart
          samples={samples}
          value={(s) => Math.max(s.rx, s.tx)}
          color={COLORS.rx}
          hoverIndex={hoverIndex}
          onHover={onHover}
          tooltip={(s) =>
            `${t('monitor.rx')} ${fmtBytesPerSec(s.rx)} · ${t('monitor.tx')} ${fmtBytesPerSec(s.tx)}`
          }
          secondValue={(s) => s.tx}
          secondColor={COLORS.tx}
        />
      </div>
    </div>
  )
}

interface MetricChartProps {
  samples: MonitorSample[]
  value: (s: MonitorSample) => number
  color: string
  hoverIndex: number
  onHover: (idx: number) => void
  tooltip: (s: MonitorSample) => string
  secondValue?: (s: MonitorSample) => number
  secondColor?: string
}

function MetricChart({
  samples,
  value,
  color,
  hoverIndex,
  onHover,
  tooltip,
  secondValue,
  secondColor
}: MetricChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const obs = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect
      setSize({ width: cr.width, height: cr.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const { width, height } = size
  const padding = { top: 4, bottom: 4 }

  const domain = useMemo(() => {
    if (secondValue) {
      const max = samples.reduce((m, s) => Math.max(m, value(s), secondValue(s)), 0)
      return { min: 0, max: max * 1.1 || 1 }
    }
    return { min: 0, max: 1 }
  }, [samples, secondValue, value])

  const xScale = (i: number) =>
    samples.length <= 1 ? width / 2 : (i / (samples.length - 1)) * width
  const yScale = (v: number) => {
    const range = domain.max - domain.min
    const ratio = range > 0 ? (v - domain.min) / range : 0
    return height - padding.bottom - ratio * (height - padding.top - padding.bottom)
  }

  const singlePath = useMemo(() => {
    if (samples.length < 2) return ''
    return samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(value(s))}`).join(' ')
  }, [samples, value])

  const areaPath = useMemo(() => {
    if (samples.length < 2 || secondValue) return ''
    const line = samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(value(s))}`)
      .join(' ')
    return `${line} L ${width} ${height} L 0 ${height} Z`
  }, [samples, secondValue, value])

  const secondPath = useMemo(() => {
    if (!secondValue || samples.length < 2) return ''
    return samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(secondValue(s))}`)
      .join(' ')
  }, [samples, secondValue])

  const hoverPos = useMemo(() => {
    if (hoverIndex < 0 || hoverIndex >= samples.length || width <= 0) return null
    const x = xScale(hoverIndex)
    const y = yScale(value(samples[hoverIndex]))
    const y2 = secondValue ? yScale(secondValue(samples[hoverIndex])) : null
    return { x, y, y2 }
  }, [hoverIndex, samples, value, secondValue])

  const handleMove = (e: React.MouseEvent) => {
    if (!containerRef.current || samples.length === 0 || width <= 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const n = samples.length
    const idx = Math.min(n - 1, Math.max(0, Math.round((x / width) * (n - 1))))
    onHover(idx)
  }

  const handleLeave = () => onHover(-1)

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {width > 0 && height > 0 && (
        <>
          <svg width={width} height={height} className="overflow-visible">
            <line
              x1={0}
              y1={height / 2}
              x2={width}
              y2={height / 2}
              stroke={COLORS.grid}
              strokeWidth={1}
            />
            {areaPath && <path d={areaPath} fill={color} opacity={0.12} />}
            <path
              d={singlePath}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {secondPath && secondColor && (
              <path
                d={secondPath}
                fill="none"
                stroke={secondColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {hoverPos && (
              <>
                <line
                  x1={hoverPos.x}
                  y1={0}
                  x2={hoverPos.x}
                  y2={height}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle cx={hoverPos.x} cy={hoverPos.y} r={3} fill={color} />
                {hoverPos.y2 !== null && secondColor && (
                  <circle cx={hoverPos.x} cy={hoverPos.y2} r={3} fill={secondColor} />
                )}
              </>
            )}
          </svg>
          {hoverIndex >= 0 && hoverIndex < samples.length && (
            <div className="absolute top-0 left-0 z-10 font-mono text-[10px] text-body bg-[rgba(8,8,8,0.9)] px-1.5 py-0.5 rounded-sm border border-white/[0.06] pointer-events-none">
              {tooltip(samples[hoverIndex])}
            </div>
          )}
        </>
      )}
    </div>
  )
}
