import type { AppSettings } from '@shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 13,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  scrollOnInput: true,
  copyOnSelect: false,
  confirmMultilinePaste: true,
  language: 'system',
  showSessionInfoBar: true,
  downloadDir: '',
  downloadConflictPolicy: 'ask',
  uploadConflictPolicy: 'ask',
  sftpPanelMode: 'panel',
  doubleClickUpload: true,
  maxConcurrentTransfers: 2,
  notifyTransferComplete: true,
  backupIncludeCredentials: true,
  backupPasswordSource: 'custom'
}

export function normalizeSettings(candidate: Partial<AppSettings>): AppSettings {
  const fontSize =
    typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize)
      ? candidate.fontSize
      : DEFAULT_SETTINGS.fontSize
  const scrollback =
    typeof candidate.scrollback === 'number' && Number.isFinite(candidate.scrollback)
      ? candidate.scrollback
      : DEFAULT_SETTINGS.scrollback
  const cursorStyle =
    candidate.cursorStyle === 'block' ||
    candidate.cursorStyle === 'underline' ||
    candidate.cursorStyle === 'bar'
      ? candidate.cursorStyle
      : DEFAULT_SETTINGS.cursorStyle
  const language =
    candidate.language === 'system' ||
    candidate.language === 'zh-CN' ||
    candidate.language === 'en-US'
      ? candidate.language
      : DEFAULT_SETTINGS.language
  const isConflictPolicy = (value: unknown): value is AppSettings['downloadConflictPolicy'] =>
    value === 'ask' || value === 'overwrite' || value === 'skip' || value === 'rename'
  const downloadConflictPolicy = isConflictPolicy(candidate.downloadConflictPolicy)
    ? candidate.downloadConflictPolicy
    : DEFAULT_SETTINGS.downloadConflictPolicy
  const legacyConfirmUploadOverwrite = (candidate as { confirmUploadOverwrite?: unknown })
    .confirmUploadOverwrite
  const uploadConflictPolicy = isConflictPolicy(candidate.uploadConflictPolicy)
    ? candidate.uploadConflictPolicy
    : typeof legacyConfirmUploadOverwrite === 'boolean'
      ? legacyConfirmUploadOverwrite
        ? 'ask'
        : 'overwrite'
      : DEFAULT_SETTINGS.uploadConflictPolicy
  const maxConcurrentTransfers =
    typeof candidate.maxConcurrentTransfers === 'number' &&
    Number.isFinite(candidate.maxConcurrentTransfers)
      ? candidate.maxConcurrentTransfers
      : DEFAULT_SETTINGS.maxConcurrentTransfers
  const sftpPanelMode =
    candidate.sftpPanelMode === 'panel' || candidate.sftpPanelMode === 'split'
      ? candidate.sftpPanelMode
      : DEFAULT_SETTINGS.sftpPanelMode

  return {
    fontSize: Math.min(24, Math.max(12.5, fontSize)),
    cursorStyle,
    cursorBlink:
      typeof candidate.cursorBlink === 'boolean'
        ? candidate.cursorBlink
        : DEFAULT_SETTINGS.cursorBlink,
    scrollback: Math.min(50000, Math.max(500, Math.round(scrollback))),
    scrollOnInput:
      typeof candidate.scrollOnInput === 'boolean'
        ? candidate.scrollOnInput
        : DEFAULT_SETTINGS.scrollOnInput,
    copyOnSelect:
      typeof candidate.copyOnSelect === 'boolean'
        ? candidate.copyOnSelect
        : DEFAULT_SETTINGS.copyOnSelect,
    confirmMultilinePaste:
      typeof candidate.confirmMultilinePaste === 'boolean'
        ? candidate.confirmMultilinePaste
        : DEFAULT_SETTINGS.confirmMultilinePaste,
    language,
    showSessionInfoBar:
      typeof candidate.showSessionInfoBar === 'boolean'
        ? candidate.showSessionInfoBar
        : DEFAULT_SETTINGS.showSessionInfoBar,
    downloadDir:
      typeof candidate.downloadDir === 'string' ? candidate.downloadDir : DEFAULT_SETTINGS.downloadDir,
    downloadConflictPolicy,
    uploadConflictPolicy,
    sftpPanelMode,
    doubleClickUpload:
      typeof candidate.doubleClickUpload === 'boolean'
        ? candidate.doubleClickUpload
        : DEFAULT_SETTINGS.doubleClickUpload,
    maxConcurrentTransfers: Math.min(4, Math.max(1, Math.round(maxConcurrentTransfers))),
    notifyTransferComplete:
      typeof candidate.notifyTransferComplete === 'boolean'
        ? candidate.notifyTransferComplete
        : DEFAULT_SETTINGS.notifyTransferComplete,
    backupIncludeCredentials:
      typeof candidate.backupIncludeCredentials === 'boolean'
        ? candidate.backupIncludeCredentials
        : DEFAULT_SETTINGS.backupIncludeCredentials,
    backupPasswordSource:
      candidate.backupPasswordSource === 'custom' || candidate.backupPasswordSource === 'random'
        ? candidate.backupPasswordSource
        : DEFAULT_SETTINGS.backupPasswordSource
  }
}
