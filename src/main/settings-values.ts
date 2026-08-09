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
