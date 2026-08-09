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
      confirmMultilinePaste: true,
      downloadConflictPolicy: 'ask',
      uploadConflictPolicy: 'ask',
      sftpPanelMode: 'panel',
      doubleClickUpload: true,
      maxConcurrentTransfers: 2,
      notifyTransferComplete: true
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
      confirmMultilinePaste: 'false',
      downloadConflictPolicy: 'replace',
      uploadConflictPolicy: 'replace',
      sftpPanelMode: 'columns',
      doubleClickUpload: 'yes',
      maxConcurrentTransfers: 99,
      notifyTransferComplete: 1
    } as unknown as Partial<typeof DEFAULT_SETTINGS>

    expect(normalizeSettings(invalid)).toMatchObject({
      fontSize: 24,
      scrollback: 500,
      cursorBlink: true,
      scrollOnInput: true,
      copyOnSelect: false,
      confirmMultilinePaste: true,
      downloadConflictPolicy: 'ask',
      uploadConflictPolicy: 'ask',
      sftpPanelMode: 'panel',
      doubleClickUpload: true,
      maxConcurrentTransfers: 4,
      notifyTransferComplete: true
    })
  })

  it('保留合法的传输偏好并规范并发数量', () => {
    expect(
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        downloadConflictPolicy: 'rename',
        uploadConflictPolicy: 'skip',
        sftpPanelMode: 'split',
        doubleClickUpload: false,
        maxConcurrentTransfers: 2.6,
        notifyTransferComplete: false
      })
    ).toMatchObject({
      downloadConflictPolicy: 'rename',
      uploadConflictPolicy: 'skip',
      sftpPanelMode: 'split',
      doubleClickUpload: false,
      maxConcurrentTransfers: 3,
      notifyTransferComplete: false
    })
  })

  it('迁移旧版上传覆盖确认布尔值', () => {
    const enabled = { ...DEFAULT_SETTINGS, uploadConflictPolicy: undefined, confirmUploadOverwrite: true }
    const disabled = { ...DEFAULT_SETTINGS, uploadConflictPolicy: undefined, confirmUploadOverwrite: false }

    expect(normalizeSettings(enabled as unknown as Partial<typeof DEFAULT_SETTINGS>).uploadConflictPolicy).toBe('ask')
    expect(normalizeSettings(disabled as unknown as Partial<typeof DEFAULT_SETTINGS>).uploadConflictPolicy).toBe('overwrite')
  })
})
