import { useCallback, useEffect, useRef, useState } from 'react'
import type { SshExecResult } from '@shared/types'
import {
  MONITOR_COLLECT_CMD,
  HOST_INFO_CMD,
  parseCollect,
  parseHostInfo,
  computeSample,
  getMaxPoints,
  readNetSpeed,
  type HostInfo,
  type MonitorSample,
  type RawSample
} from './monitor'

export interface MonitorSessionState {
  samples: MonitorSample[]
  hostInfo: HostInfo | null
  selectedIface: string
  loading: boolean
  error: string | null
  paused: boolean
}

export interface UseBackgroundMonitorResult {
  states: Record<string, MonitorSessionState>
  openMonitor: (sessionId: string) => void
  closeMonitor: (sessionId: string) => void
  togglePause: (sessionId: string) => void
  setIface: (sessionId: string, iface: string) => void
}

interface SessionRuntime {
  samples: MonitorSample[]
  hostInfo: HostInfo | null
  selectedIface: string
  loading: boolean
  error: string | null
  paused: boolean
  rawPrev?: RawSample
  intervalId?: ReturnType<typeof setInterval>
  mounted: boolean
}

export function useBackgroundMonitor(
  execFor: (sessionId: string) => (command: string) => Promise<SshExecResult>,
  connectedSessions: string[],
  autoStart: boolean,
  intervalSec: number
): UseBackgroundMonitorResult {
  const [states, setStates] = useState<Record<string, MonitorSessionState>>({})
  const runtimesRef = useRef<Record<string, SessionRuntime>>({})
  const execRef = useRef(execFor)
  const autoStartRef = useRef(autoStart)
  const intervalSecRef = useRef(intervalSec)

  useEffect(() => {
    execRef.current = execFor
  }, [execFor])
  useEffect(() => {
    autoStartRef.current = autoStart
  }, [autoStart])
  useEffect(() => {
    intervalSecRef.current = intervalSec
  }, [intervalSec])

  const syncState = useCallback((sessionId: string) => {
    const rt = runtimesRef.current[sessionId]
    if (!rt) return
    setStates((prev) => ({
      ...prev,
      [sessionId]: {
        samples: rt.samples,
        hostInfo: rt.hostInfo,
        selectedIface: rt.selectedIface,
        loading: rt.loading,
        error: rt.error,
        paused: rt.paused
      }
    }))
  }, [])

  const stopRuntime = useCallback((sessionId: string) => {
    const rt = runtimesRef.current[sessionId]
    if (!rt) return
    rt.mounted = false
    if (rt.intervalId) {
      clearInterval(rt.intervalId)
      rt.intervalId = undefined
    }
    delete runtimesRef.current[sessionId]
    setStates((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const collectOnce = useCallback(async (sessionId: string, rt: SessionRuntime) => {
    if (!rt.selectedIface) return
    const exec = execRef.current(sessionId)
    try {
      const res = await exec(MONITOR_COLLECT_CMD(rt.selectedIface))
      if (!rt.mounted) return
      const raw = { ...parseCollect(res), timestamp: Date.now() } as RawSample
      const sample = computeSample(rt.rawPrev, raw, intervalSecRef.current)
      rt.rawPrev = raw
      rt.samples = [...rt.samples, sample]
      const maxPoints = getMaxPoints(intervalSecRef.current)
      while (rt.samples.length > maxPoints) rt.samples.shift()
      rt.error = null
      syncState(sessionId)
    } catch (e) {
      if (!rt.mounted) return
      rt.error = String(e)
      syncState(sessionId)
    }
  }, [syncState])

  const startRuntime = useCallback(
    async (sessionId: string) => {
      if (runtimesRef.current[sessionId]) {
        const rt = runtimesRef.current[sessionId]
        rt.mounted = true
        syncState(sessionId)
        return
      }
      const rt: SessionRuntime = {
        samples: [],
        hostInfo: null,
        selectedIface: '',
        loading: true,
        error: null,
        paused: false,
        mounted: true
      }
      runtimesRef.current[sessionId] = rt
      syncState(sessionId)

      const exec = execRef.current(sessionId)
      try {
        const res = await exec(HOST_INFO_CMD)
        if (!rt.mounted) return
        const info = await parseHostInfo(exec, res)
        if (!rt.mounted) return
        rt.hostInfo = info
        rt.selectedIface = info.netIface
        rt.loading = false
        rt.error = null
        syncState(sessionId)
        if (info.os.toLowerCase() === 'linux') {
          await collectOnce(sessionId, rt)
        }
      } catch (e) {
        if (!rt.mounted) return
        rt.loading = false
        rt.error = String(e)
        syncState(sessionId)
      }
    },
    [collectOnce, syncState]
  )

  const ensureInterval = useCallback((sessionId: string) => {
    const rt = runtimesRef.current[sessionId]
    if (!rt || rt.intervalId || rt.paused || !rt.selectedIface) return
    rt.intervalId = setInterval(() => collectOnce(sessionId, rt), intervalSecRef.current * 1000)
  }, [collectOnce])

  const clearIntervalFor = useCallback((sessionId: string) => {
    const rt = runtimesRef.current[sessionId]
    if (!rt) return
    if (rt.intervalId) {
      clearInterval(rt.intervalId)
      rt.intervalId = undefined
    }
  }, [])

  // 连接成功且后台开关打开时自动启动
  useEffect(() => {
    if (!autoStartRef.current) return
    for (const sessionId of connectedSessions) {
      const rt = runtimesRef.current[sessionId]
      if (!rt) startRuntime(sessionId)
      else if (!rt.intervalId && !rt.paused) ensureInterval(sessionId)
    }
  }, [connectedSessions, startRuntime, ensureInterval])

  // 清理已不在连接列表中的会话
  useEffect(() => {
    const connectedSet = new Set(connectedSessions)
    for (const sessionId of Object.keys(runtimesRef.current)) {
      if (!connectedSet.has(sessionId)) stopRuntime(sessionId)
    }
  }, [connectedSessions, stopRuntime])

  const openMonitor = useCallback(
    (sessionId: string) => {
      const rt = runtimesRef.current[sessionId]
      if (!rt) {
        startRuntime(sessionId).then(() => {
          const created = runtimesRef.current[sessionId]
          if (created) ensureInterval(sessionId)
        })
      } else {
        rt.mounted = true
        ensureInterval(sessionId)
        syncState(sessionId)
      }
    },
    [startRuntime, ensureInterval, syncState]
  )

  const closeMonitor = useCallback(
    (sessionId: string) => {
      const rt = runtimesRef.current[sessionId]
      if (!rt) return
      clearIntervalFor(sessionId)
      syncState(sessionId)
    },
    [clearIntervalFor, syncState]
  )

  const togglePause = useCallback(
    (sessionId: string) => {
      const rt = runtimesRef.current[sessionId]
      if (!rt) return
      rt.paused = !rt.paused
      if (rt.paused) {
        clearIntervalFor(sessionId)
      } else {
        ensureInterval(sessionId)
        collectOnce(sessionId, rt)
      }
      syncState(sessionId)
    },
    [clearIntervalFor, ensureInterval, collectOnce, syncState]
  )

  const setIface = useCallback(
    async (sessionId: string, iface: string) => {
      const rt = runtimesRef.current[sessionId]
      if (!rt) return
      rt.selectedIface = iface
      rt.rawPrev = undefined
      rt.samples = []
      const speed = await readNetSpeed(execRef.current(sessionId), iface)
      if (!rt.mounted) return
      if (rt.hostInfo) rt.hostInfo = { ...rt.hostInfo, netIface: iface, netSpeed: speed }
      syncState(sessionId)
      collectOnce(sessionId, rt)
    },
    [collectOnce, syncState]
  )

  return {
    states,
    openMonitor,
    closeMonitor,
    togglePause,
    setIface
  }
}
