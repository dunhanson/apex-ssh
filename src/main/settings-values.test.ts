import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings-values'

describe('normalizeSettings', () => {
  it('旧设置缺少新增终端字段时补齐产品默认值', () => {
    expect(
      normalizeSettings({
        fontSize: 14,
        cursorStyle: 'bar',
        scrollback: 1000
      })
    ).toMatchObject({
      cursorBlink: true,
      scrollOnInput: true,
      copyOnSelect: false,
      confirmMultilinePaste: true
    })
  })

  it('保留合法的终端交互偏好', () => {
    expect(
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        cursorBlink: false,
        scrollOnInput: false,
        copyOnSelect: true,
        confirmMultilinePaste: false
      })
    ).toMatchObject({
      cursorBlink: false,
      scrollOnInput: false,
      copyOnSelect: true,
      confirmMultilinePaste: false
    })
  })

  it('非法字段回退默认值并继续收敛数值边界', () => {
    const invalid = {
      ...DEFAULT_SETTINGS,
      fontSize: 100,
      scrollback: 12,
      cursorBlink: 'yes',
      scrollOnInput: 1,
      copyOnSelect: null,
      confirmMultilinePaste: 'false'
    } as unknown as Partial<typeof DEFAULT_SETTINGS>

    expect(normalizeSettings(invalid)).toMatchObject({
      fontSize: 24,
      scrollback: 500,
      cursorBlink: true,
      scrollOnInput: true,
      copyOnSelect: false,
      confirmMultilinePaste: true
    })
  })
})
