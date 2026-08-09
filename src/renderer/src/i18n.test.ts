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

describe('上传同名确认文案', () => {
  it('在中文 sftp 命名空间中可正常解析', () => {
    expect(i18n.getResource('zh-CN', 'translation', 'sftp.uploadConflictTitle')).toBe(
      '覆盖远端同名项目？'
    )
    expect(i18n.t('sftp.uploadConflictDesc', { lng: 'zh-CN', names: 'demo.txt' })).toBe(
      '远端目录已存在同名项目：demo.txt'
    )
  })

  it('在英文 sftp 命名空间中可正常解析', () => {
    expect(i18n.getResource('en-US', 'translation', 'sftp.uploadConflictTitle')).toBe(
      'Overwrite remote items?'
    )
    expect(i18n.t('sftp.uploadConflictDesc', { lng: 'en-US', names: 'demo.txt' })).toBe(
      'Items with the same name already exist remotely: demo.txt'
    )
  })
})
