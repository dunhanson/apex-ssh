import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { i18n as I18nInstance } from 'i18next'

let i18n: I18nInstance

beforeAll(async () => {
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  vi.stubGlobal('window', {
    api: {
      settings: {
        get: vi.fn().mockResolvedValue({ language: 'zh-CN' }),
        onChanged: vi.fn(),
        set: vi.fn()
      }
    }
  })

  i18n = (await import('./i18n')).default
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('同名项目逐项确认文案', () => {
  it('在中文 sftp 命名空间中可正常解析', () => {
    expect(i18n.getResource('zh-CN', 'translation', 'sftp.uploadConflictTitle')).toBe(
      '远端项目已存在'
    )
    expect(i18n.t('sftp.uploadConflictDesc', { lng: 'zh-CN', name: 'demo.txt' })).toBe(
      '远端已存在同名项目：demo.txt'
    )
    expect(i18n.t('sftp.applyAll', { lng: 'zh-CN' })).toBe('应用所有')
  })

  it('在英文 sftp 命名空间中可正常解析', () => {
    expect(i18n.getResource('en-US', 'translation', 'sftp.uploadConflictTitle')).toBe(
      'Remote item already exists'
    )
    expect(i18n.t('sftp.uploadConflictDesc', { lng: 'en-US', name: 'demo.txt' })).toBe(
      'An item with the same name already exists remotely: demo.txt'
    )
    expect(i18n.t('sftp.applyAll', { lng: 'en-US' })).toBe('Apply to all')
  })
})

describe('关于设置分组文案', () => {
  it('提供中英文应用信息标题', () => {
    expect(i18n.t('settings.appInfo', { lng: 'zh-CN' })).toBe('应用信息')
    expect(i18n.t('settings.appInfo', { lng: 'en-US' })).toBe('Application information')
  })
})
