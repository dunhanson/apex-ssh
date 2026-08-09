import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { classifyUpdateError, createInitialStatus, reduceUpdateEvent } from './updater-state'

/** 安装版（完整能力）从 idle 起步 */
const full = createInitialStatus('0.1.0', 'full')
/** 开发环境（仅检查） */
const checkOnly = createInitialStatus('0.1.0', 'check-only')

describe('createInitialStatus', () => {
  it('安装版初始为 idle，携带当前版本', () => {
    expect(full).toEqual({ state: 'idle', supported: true, checkOnly: false, currentVersion: '0.1.0' })
  })

  it('开发环境为 check-only 模式', () => {
    expect(checkOnly).toMatchObject({ state: 'idle', supported: true, checkOnly: true })
  })

  it('非 Windows 固定为 unsupported', () => {
    const status = createInitialStatus('0.1.0', 'unsupported')
    expect(status).toMatchObject({ state: 'unsupported', supported: false, checkOnly: false })
  })
})

describe('classifyUpdateError 错误归类', () => {
  it('Release 缺少 latest.yml / 404 → no-release', () => {
    expect(
      classifyUpdateError('Cannot find latest.yml in the latest release artifacts: HttpError: 404')
    ).toBe('no-release')
  })

  it('网络类错误 → network', () => {
    expect(classifyUpdateError('Error: net::ERR_INTERNET_DISCONNECTED')).toBe('network')
    expect(classifyUpdateError('getaddrinfo ENOTFOUND github.com')).toBe('network')
    expect(classifyUpdateError('connect ETIMEDOUT 20.205.243.166:443')).toBe('network')
  })

  it('校验类错误 → verify', () => {
    expect(classifyUpdateError('sha512 checksum mismatch')).toBe('verify')
    expect(classifyUpdateError('signature verification failed')).toBe('verify')
  })

  it('其他错误 → unknown', () => {
    expect(classifyUpdateError('Something unexpected happened')).toBe('unknown')
  })
})

describe('reduceUpdateEvent 正常升级链路', () => {
  it('idle → checking → downloading → downloaded → installing', () => {
    let s: UpdateStatus = full
    s = reduceUpdateEvent(s, { type: 'checking' })
    expect(s.state).toBe('checking')
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    expect(s).toMatchObject({ state: 'downloading', version: '0.2.0', progress: 0 })
    s = reduceUpdateEvent(s, { type: 'progress', percent: 42.6 })
    expect(s.progress).toBe(43)
    s = reduceUpdateEvent(s, { type: 'downloaded', version: '0.2.0' })
    expect(s).toMatchObject({ state: 'downloaded', progress: 100 })
    s = reduceUpdateEvent(s, { type: 'install-requested' })
    expect(s.state).toBe('installing')
  })

  it('checking 后无更新 → up-to-date', () => {
    let s = reduceUpdateEvent(full, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'not-available' })
    expect(s.state).toBe('up-to-date')
    expect(s.version).toBeUndefined()
  })

  it('检查失败 → error 携带归类码，可重试并清除错误', () => {
    let s = reduceUpdateEvent(full, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'error', message: 'net::ERR_CONNECTION_REFUSED', code: 'network' })
    expect(s).toMatchObject({ state: 'error', errorCode: 'network', message: 'net::ERR_CONNECTION_REFUSED' })
    s = reduceUpdateEvent(s, { type: 'checking' })
    expect(s.state).toBe('checking')
    expect(s.message).toBeUndefined()
    expect(s.errorCode).toBeUndefined()
  })

  it('下载失败 → error，可重新检查并再次进入下载', () => {
    let s = reduceUpdateEvent(full, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    s = reduceUpdateEvent(s, { type: 'error', message: 'unable to verify the first certificate', code: 'unknown' })
    expect(s.state).toBe('error')
    s = reduceUpdateEvent(s, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    expect(s.state).toBe('downloading')
  })
})

describe('reduceUpdateEvent 开发环境（check-only）', () => {
  it('发现新版本停在 available，不进入下载', () => {
    let s = reduceUpdateEvent(checkOnly, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    expect(s).toMatchObject({ state: 'available', version: '0.2.0' })
    expect(s.progress).toBeUndefined()
  })

  it('available 状态不能进入 installing', () => {
    let s = reduceUpdateEvent(checkOnly, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    expect(reduceUpdateEvent(s, { type: 'install-requested' }).state).toBe('available')
  })

  it('available 后可再次检查回到最新或更新', () => {
    let s = reduceUpdateEvent(checkOnly, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    s = reduceUpdateEvent(s, { type: 'checking' })
    expect(s.state).toBe('checking')
  })
})

describe('reduceUpdateEvent 非法迁移守卫', () => {
  it('unsupported 不再流转', () => {
    const s = createInitialStatus('0.1.0', 'unsupported')
    expect(reduceUpdateEvent(s, { type: 'checking' }).state).toBe('unsupported')
    expect(reduceUpdateEvent(s, { type: 'available', version: '9.9.9' }).state).toBe('unsupported')
  })

  it('非 downloading 状态忽略进度事件', () => {
    const s = reduceUpdateEvent(full, { type: 'progress', percent: 80 })
    expect(s.state).toBe('idle')
    expect(s.progress).toBeUndefined()
  })

  it('下载/已下载期间重复检查不打断进度', () => {
    let s = reduceUpdateEvent(full, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    s = reduceUpdateEvent(s, { type: 'progress', percent: 55 })
    expect(reduceUpdateEvent(s, { type: 'checking' })).toBe(s)
    s = reduceUpdateEvent(s, { type: 'downloaded', version: '0.2.0' })
    expect(reduceUpdateEvent(s, { type: 'checking' })).toBe(s)
  })

  it('仅 downloaded 可进入 installing；installing 后不再流转', () => {
    expect(reduceUpdateEvent(full, { type: 'install-requested' }).state).toBe('idle')
    let s = reduceUpdateEvent(full, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    s = reduceUpdateEvent(s, { type: 'downloaded', version: '0.2.0' })
    s = reduceUpdateEvent(s, { type: 'install-requested' })
    expect(s.state).toBe('installing')
    expect(reduceUpdateEvent(s, { type: 'error', message: 'x', code: 'unknown' }).state).toBe('installing')
  })

  it('进度百分比收敛到 0-100 的整数', () => {
    let s = reduceUpdateEvent(full, { type: 'checking' })
    s = reduceUpdateEvent(s, { type: 'available', version: '0.2.0' })
    expect(reduceUpdateEvent(s, { type: 'progress', percent: 120 }).progress).toBe(100)
    expect(reduceUpdateEvent(s, { type: 'progress', percent: -5 }).progress).toBe(0)
  })
})
