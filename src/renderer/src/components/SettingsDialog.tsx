import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  CloudUpload,
  Copy,
  DatabaseBackup,
  Download,
  FolderDown,
  Info,
  MonitorCog,
  RefreshCw,
  RotateCcw,
  Rocket,
  SquareTerminal,
  Upload,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AppSettings,
  CloudSyncConnectionInput,
  CloudSyncState,
  EncryptedBackupStats,
  UpdateStatus
} from '@shared/types'
import logoUrl from '@/assets/logo.svg'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useSettings, setSettings } from '@/lib/settings'
import { generateBackupPassword } from '@/lib/backup-password'
import { cn } from '@/lib/utils'

interface SettingsWorkspaceProps {
  onHostsImported: () => Promise<void>
  /** 活动（连接中 / 已连接）SSH 会话数，用于「立即重启更新」前的断开提示 */
  activeSessions: number
}

function SettingToggle({
  checked,
  emphasized = false,
  label,
  onChange
}: {
  checked: boolean
  emphasized?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors cursor-pointer outline-none',
        checked && emphasized
          ? 'border-settings-emphasis/40 bg-settings-emphasis/[0.12]'
          : checked
            ? 'border-white/25 bg-white/[0.12]'
            : 'border-settings-control bg-elevated'
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'absolute top-[3px] size-3 rounded-full transition-[left,background-color]',
          checked
            ? cn('left-[19px]', emphasized ? 'bg-settings-emphasis' : 'bg-fg')
            : 'left-[3px] bg-faint'
        )}
      />
    </button>
  )
}

function NumericSetting({
  id,
  value,
  min,
  max,
  step,
  integer = false,
  onChange
}: {
  id: string
  value: number
  min: number
  max: number
  step: number
  integer?: boolean
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const applyValidValue = (raw: string) => {
    setDraft(raw)
    if (raw.trim() === '') return
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      onChange(integer ? Math.round(parsed) : parsed)
    }
  }

  const normalize = () => {
    if (draft.trim() === '') {
      setDraft(String(value))
      return
    }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const normalized = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed))
    setDraft(String(normalized))
    if (normalized !== value) onChange(normalized)
  }

  return (
    <NumberInput
      id={id}
      min={min}
      max={max}
      step={step}
      value={draft}
      incrementLabel={t('common.increaseValue')}
      decrementLabel={t('common.decreaseValue')}
      onValueChange={applyValidValue}
      onBlur={normalize}
    />
  )
}

function SettingSelect({
  id,
  value,
  options,
  onChange
}: {
  id: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        className="h-9 w-full appearance-none bg-surface border border-line rounded-sm px-2.5 py-[7px] pr-9 font-mono text-[12.5px] text-fg outline-none transition-colors duration-100 focus:border-white/20 cursor-pointer"
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
    </div>
  )
}

function SettingsSection({
  title,
  description,
  showTitle = true,
  children
}: {
  title: string
  description?: string
  showTitle?: boolean
  children: ReactNode
}) {
  return (
    <section className="settings-section">
      {showTitle && (
        <div className="settings-section-heading">
          <h2 className="settings-section-title">{title}</h2>
          {description && <p className="settings-section-description">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

type SettingsCategory = 'terminal' | 'interface' | 'transfer' | 'backup' | 'sync' | 'about'

interface SettingsCategoryItem {
  id: SettingsCategory
  label: string
  description: string
  icon: LucideIcon
}

export function SettingsWorkspace({ onHostsImported, activeSessions }: SettingsWorkspaceProps) {
  const { t } = useTranslation()
  const settings = useSettings()
  const [category, setCategory] = useState<SettingsCategory>('terminal')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [restartAsk, setRestartAsk] = useState(false)
  const [backupStats, setBackupStats] = useState<EncryptedBackupStats | null>(null)
  const [backupPasswordMode, setBackupPasswordMode] = useState<'export' | 'import' | null>(null)
  const [backupPassword, setBackupPassword] = useState('')
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<EncryptedBackupStats | null>(null)
  const [syncState, setSyncState] = useState<CloudSyncState | null>(null)
  const [syncForm, setSyncForm] = useState({
    host: '',
    port: '5432',
    database: '',
    user: '',
    password: ''
  })
  const [syncKeyInput, setSyncKeyInput] = useState('')
  const [syncKeySource, setSyncKeySource] = useState<'generate' | 'existing'>('generate')
  const [syncGeneratedCopyAvailable, setSyncGeneratedCopyAvailable] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [regenKeyAsk, setRegenKeyAsk] = useState(false)
  const [clearRemoteAsk, setClearRemoteAsk] = useState(false)
  const patch = (value: Partial<AppSettings>) => setSettings(value)
  const includeCredentials = settings.backupIncludeCredentials
  const backupPasswordSource = settings.backupPasswordSource

  // 版本与更新状态：初始拉取一次，后续跟随主进程状态广播
  useEffect(() => {
    let mounted = true
    window.api.updater.getStatus().then((status) => {
      if (mounted) setUpdateStatus(status)
    })
    const off = window.api.updater.onStatusChanged(setUpdateStatus)
    return () => {
      mounted = false
      off()
    }
  }, [])

  // 云同步状态：初始拉取一次，后续跟随主进程状态广播；连接参数只读安全视图（不含密码）
  useEffect(() => {
    let mounted = true
    window.api.cloudSync.getState().then((state) => {
      if (mounted) setSyncState(state)
    })
    window.api.cloudSync.getConnection().then((connection) => {
      if (mounted && connection) {
        setSyncForm({
          host: connection.host,
          port: String(connection.port),
          database: connection.database,
          user: connection.user,
          password: ''
        })
      }
    })
    const off = window.api.cloudSync.onStateChanged(setSyncState)
    return () => {
      mounted = false
      off()
    }
  }, [])

  useEffect(() => {
    if (!includeCredentials) {
      setBackupStats(null)
      return
    }
    let mounted = true
    window.api.hosts
      .getBackupStats()
      .then((stats) => {
        if (mounted) setBackupStats(stats)
      })
      .catch((error) => toast.error(t('settings.backupFailed', { message: String(error) })))
    return () => {
      mounted = false
    }
  }, [includeCredentials, t])
  const categories: SettingsCategoryItem[] = [
    {
      id: 'terminal',
      label: t('settings.terminal'),
      description: t('settings.terminalDescription'),
      icon: SquareTerminal
    },
    {
      id: 'interface',
      label: t('settings.interface'),
      description: t('settings.interfaceDescription'),
      icon: MonitorCog
    },
    {
      id: 'transfer',
      label: t('settings.transfer'),
      description: t('settings.transferDescription'),
      icon: FolderDown
    },
    {
      id: 'backup',
      label: t('settings.hostBackup'),
      description: t('settings.backupDescription'),
      icon: DatabaseBackup
    },
    {
      id: 'sync',
      label: t('settings.cloudSync'),
      description: t('settings.cloudSyncDescription'),
      icon: CloudUpload
    },
    {
      id: 'about',
      label: t('settings.about'),
      description: t('settings.aboutDescription'),
      icon: Info
    }
  ]
  const activeCategory = categories.find((item) => item.id === category) ?? categories[0]

  const closePasswordDialog = async () => {
    if (backupPasswordMode === 'import') await window.api.hosts.cancelEncryptedBackup()
    setBackupPasswordMode(null)
    setBackupPassword('')
    setBackupPasswordConfirm('')
  }

  const exportBackup = async () => {
    if (includeCredentials) {
      setBackupPasswordMode('export')
      if (backupPasswordSource === 'random') generateBackupPasswordValue()
      return
    }
    try {
      const result = await window.api.hosts.exportBackup()
      if (result.status === 'success') {
        toast.success(
          t('settings.exportSuccess', {
            count: result.count,
            omitted: result.omittedSecrets ?? 0
          })
        )
      }
    } catch (error) {
      toast.error(t('settings.backupFailed', { message: String(error) }))
    }
  }

  const importBackup = async () => {
    try {
      const result = await window.api.hosts.importBackup({ includeCredentials })
      if (result.status === 'password-required') {
        setBackupPasswordMode('import')
      } else if (result.status === 'success') {
        await onHostsImported()
        toast.success(
          t('settings.importSuccess', {
            count: result.count,
            unresolved: result.unresolvedCredentials ?? 0
          })
        )
      }
    } catch (error) {
      toast.error(t('settings.backupFailed', { message: String(error) }))
    }
  }

  const copyBackupPassword = async (password: string) => {
    const toastId = 'backup-password-copy'
    try {
      const copied = await window.api.clipboard.writeText(password)
      if (copied) {
        toast.success(t('settings.randomBackupPasswordCopied'), { id: toastId })
      } else {
        toast.error(t('settings.randomBackupPasswordCopyFailed'), { id: toastId })
      }
    } catch {
      toast.error(t('settings.randomBackupPasswordCopyFailed'), { id: toastId })
    }
  }

  const generateBackupPasswordValue = () => {
    const password = generateBackupPassword()
    setBackupPassword(password)
    setBackupPasswordConfirm('')
  }

  const selectBackupPasswordSource = (source: 'custom' | 'random') => {
    if (backupPasswordSource === source) return
    patch({ backupPasswordSource: source })
    setBackupPassword('')
    setBackupPasswordConfirm('')
    if (source === 'random') generateBackupPasswordValue()
  }

  const submitBackupPassword = async () => {
    if (backupPassword.length < 12) {
      toast.error(t('settings.backupPasswordTooShort'))
      return
    }
    if (
      backupPasswordMode === 'export' &&
      backupPasswordSource === 'custom' &&
      backupPassword !== backupPasswordConfirm
    ) {
      toast.error(t('settings.backupPasswordMismatch'))
      return
    }
    setBackupBusy(true)
    try {
      if (backupPasswordMode === 'export') {
        const result = await window.api.hosts.exportBackup({
          includeCredentials: true,
          password: backupPassword
        })
        if (result.status === 'success' && result.stats) {
          const { hosts, passwords, keys } = result.stats
          toast.success(t('settings.encryptedExportSuccess', { hosts, passwords, keys }))
        }
        await closePasswordDialog()
      } else if (backupPasswordMode === 'import') {
        const result = await window.api.hosts.unlockEncryptedBackup(backupPassword)
        if (result.status === 'preview' && result.stats) {
          setImportPreview(result.stats)
          setBackupPasswordMode(null)
          setBackupPassword('')
        }
      }
    } catch (error) {
      toast.error(t('settings.backupFailed', { message: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  const commitEncryptedImport = async (mode: 'merge' | 'replace') => {
    setBackupBusy(true)
    try {
      const result = await window.api.hosts.commitEncryptedBackup(mode)
      if (result.status === 'success') {
        await onHostsImported()
        const { hosts = 0, passwords = 0, keys = 0 } = result.stats ?? {}
        toast.success(t('settings.encryptedImportSuccess', { hosts, passwords, keys }))
        setImportPreview(null)
      }
    } catch (error) {
      toast.error(t('settings.backupFailed', { message: String(error) }))
    } finally {
      setBackupBusy(false)
    }
  }

  const syncConnectionInput = (): CloudSyncConnectionInput => ({
    host: syncForm.host,
    port: Number(syncForm.port),
    database: syncForm.database,
    user: syncForm.user,
    ...(syncForm.password ? { password: syncForm.password } : {})
  })

  const updateSyncField = (field: keyof typeof syncForm, value: string) => {
    setSyncForm((form) => ({ ...form, [field]: value }))
  }

  const runSyncAction = async (action: () => Promise<string | null>, successKey?: string) => {
    setSyncBusy(true)
    try {
      const error = await action()
      if (error) toast.error(t('settings.syncFailed', { message: error }))
      else if (successKey) toast.success(t(successKey))
    } catch (error) {
      toast.error(t('settings.syncFailed', { message: String(error) }))
    } finally {
      setSyncBusy(false)
    }
  }

  const saveSyncConnection = () =>
    runSyncAction(async () => {
      const error = await window.api.cloudSync.saveConnection(syncConnectionInput())
      if (!error) setSyncForm((form) => ({ ...form, password: '' }))
      return error
    }, 'settings.syncConnectionSaved')

  const testSyncConnection = () =>
    runSyncAction(
      () => window.api.cloudSync.testConnection(syncConnectionInput()),
      'settings.syncConnectionOk'
    )

  const generateSyncKey = async () => {
    setRegenKeyAsk(false)
    setSyncBusy(true)
    try {
      const result = (await window.api.cloudSync.generateKey()) as
        | Awaited<ReturnType<typeof window.api.cloudSync.generateKey>>
        | { copied: boolean; error: string | null }
        | string
        | null
      // 开发环境可能只热更新渲染层，旧主进程仍返回 string | null 并保留 copyKey。
      if (result === null || typeof result === 'string') {
        setSyncGeneratedCopyAvailable(true)
        toast.success(t('settings.syncKeyGenerated'))
        if (typeof result === 'string') {
          toast.error(t('settings.syncFailed', { message: result }))
        }
        return
      }
      if ('copied' in result) {
        setSyncGeneratedCopyAvailable(false)
        toast.error(t('settings.syncLegacyKeyGenerated'))
        if (result.error) toast.error(t('settings.syncFailed', { message: result.error }))
        return
      }
      setSyncGeneratedCopyAvailable(result.copyAvailable)
      if (result.copyAvailable) toast.success(t('settings.syncKeyGenerated'))
      if (result.error) toast.error(t('settings.syncFailed', { message: result.error }))
    } catch (error) {
      toast.error(t('settings.syncFailed', { message: String(error) }))
    } finally {
      setSyncBusy(false)
    }
  }

  const copyGeneratedSyncKey = async () => {
    const api = window.api.cloudSync as typeof window.api.cloudSync & {
      copyKey?: () => Promise<boolean>
    }
    try {
      const copied = await (api.copyGeneratedKey?.() ?? api.copyKey?.() ?? Promise.resolve(false))
      if (copied) {
        setSyncGeneratedCopyAvailable(false)
        toast.success(t('settings.syncKeyCopied'))
      } else toast.error(t('settings.syncKeyCopyFailed'))
    } catch {
      toast.error(t('settings.syncKeyCopyFailed'))
    }
  }

  const submitSyncKey = () =>
    runSyncAction(async () => {
      const error = await window.api.cloudSync.setKey(syncKeyInput)
      if (!error) setSyncKeyInput('')
      return error
    }, 'settings.syncKeySaved')

  const toggleSyncEnabled = (enabled: boolean) =>
    runSyncAction(
      () => window.api.cloudSync.setEnabled(enabled),
      enabled ? 'settings.syncEnabled' : 'settings.syncDisabled'
    )

  const clearRemote = async () => {
    setClearRemoteAsk(false)
    await runSyncAction(window.api.cloudSync.clearRemote, 'settings.syncCleared')
  }

  const syncStatusText = (): string => {
    if (!syncState) return t('settings.syncLoading')
    if (syncState.syncing) return t('settings.syncSyncing')
    switch (syncState.errorCode) {
      case 'connection':
        return t('settings.syncErrorConnection')
      case 'key':
        return t('settings.syncErrorKey')
      case 'format':
        return t('settings.syncErrorFormat')
      case 'unknown':
        return t('settings.syncErrorUnknown')
    }
    if (syncState.lastSyncAt) {
      return t('settings.syncLastSyncAt', { time: new Date(syncState.lastSyncAt).toLocaleString() })
    }
    return t('settings.syncNever')
  }

  const updateStatusText = (): string => {    if (!updateStatus) return t('settings.updateLoading')
    switch (updateStatus.state) {
      case 'idle':
        return t('settings.updateIdle')
      case 'checking':
        return t('settings.updateChecking')
      case 'up-to-date':
        return t('settings.updateUpToDate')
      case 'available':
        return t('settings.updateAvailable', { version: updateStatus.version ?? '' })
      case 'downloading':
        return t('settings.updateDownloading', { percent: updateStatus.progress ?? 0 })
      case 'downloaded':
        return t('settings.updateDownloaded', { version: updateStatus.version ?? '' })
      case 'installing':
        return t('settings.updateInstalling')
      case 'error':
        // 只展示归类后的友好文案；原始错误（HTTP 头、堆栈）留在主进程日志
        switch (updateStatus.errorCode) {
          case 'network':
            return t('settings.updateErrorNetwork')
          case 'no-release':
            return t('settings.updateErrorNoRelease')
          case 'verify':
            return t('settings.updateErrorVerify')
          default:
            return t('settings.updateErrorUnknown')
        }
      case 'unsupported':
        return t('settings.updateUnsupported')
    }
  }

  return (
    <Tabs
      value={category}
      orientation="vertical"
      onValueChange={(value) => setCategory(value as SettingsCategory)}
      className="settings-workspace"
    >
      <TabsList variant="settings" aria-label={t('settings.title')}>
        <div className="settings-navigation-title">{t('settings.title')}</div>
        {categories.map(({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id} variant="settings">
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="settings-workspace-main">
        <header className="settings-workspace-header">
          <div className="min-w-0">
            <h1 className="settings-page-title">
              {activeCategory.label}
            </h1>
            <p className="settings-page-description truncate">
              {activeCategory.description}
            </p>
          </div>
          <span className="settings-page-meta ml-auto shrink-0">
            {t('settings.autoApplied')}
          </span>
        </header>

        <div className="settings-workspace-content">
          <TabsContent value="terminal">
            <SettingsSection title={t('settings.fontGroup')}>
              <div className="settings-form-grid">
                <div>
                  <Label htmlFor="settings-font-size">{t('settings.fontSize')}</Label>
                  <NumericSetting
                    id="settings-font-size"
                    value={settings.fontSize}
                    min={12.5}
                    max={24}
                    step={0.5}
                    onChange={(fontSize) => patch({ fontSize })}
                  />
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.cursorGroup')}>
              <div className="settings-form-grid">
                <div>
                  <Label htmlFor="settings-cursor-style">{t('settings.cursorStyle')}</Label>
                  <SettingSelect
                    id="settings-cursor-style"
                    value={settings.cursorStyle}
                    options={[
                      { value: 'block', label: t('settings.cursorBlock') },
                      { value: 'underline', label: t('settings.cursorUnderline') },
                      { value: 'bar', label: t('settings.cursorBar') }
                    ]}
                    onChange={(cursorStyle) =>
                      patch({ cursorStyle: cursorStyle as AppSettings['cursorStyle'] })
                    }
                  />
                </div>
                <div>
                  <Label>{t('settings.cursorBlink')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-2.5">
                    <span
                      className={cn(
                        'font-mono text-[12px]',
                        settings.cursorBlink ? 'text-body' : 'text-faint'
                      )}
                    >
                      {settings.cursorBlink ? t('common.enabled') : t('common.disabled')}
                    </span>
                    <SettingToggle
                      checked={settings.cursorBlink}
                      label={t('settings.cursorBlink')}
                      onChange={(cursorBlink) => patch({ cursorBlink })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.scrollGroup')}>
              <div className="settings-form-grid">
                <div>
                  <Label htmlFor="settings-scrollback">{t('settings.scrollback')}</Label>
                  <NumericSetting
                    id="settings-scrollback"
                    value={settings.scrollback}
                    min={500}
                    max={50000}
                    step={500}
                    integer
                    onChange={(scrollback) => patch({ scrollback })}
                  />
                </div>
                <div>
                  <Label>{t('settings.scrollOnInput')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-2.5">
                    <span
                      className={cn(
                        'font-mono text-[12px]',
                        settings.scrollOnInput ? 'text-body' : 'text-faint'
                      )}
                    >
                      {settings.scrollOnInput ? t('common.enabled') : t('common.disabled')}
                    </span>
                    <SettingToggle
                      checked={settings.scrollOnInput}
                      label={t('settings.scrollOnInput')}
                      onChange={(scrollOnInput) => patch({ scrollOnInput })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.interactionGroup')}>
              <div className="settings-form-grid">
                <div>
                  <Label>{t('settings.copyOnSelect')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-2.5">
                    <span
                      className={cn(
                        'font-mono text-[12px]',
                        settings.copyOnSelect ? 'text-body' : 'text-faint'
                      )}
                    >
                      {settings.copyOnSelect ? t('common.enabled') : t('common.disabled')}
                    </span>
                    <SettingToggle
                      checked={settings.copyOnSelect}
                      label={t('settings.copyOnSelect')}
                      onChange={(copyOnSelect) => patch({ copyOnSelect })}
                    />
                  </div>
                </div>
                <div>
                  <Label>{t('settings.confirmMultilinePaste')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-2.5">
                    <span
                      className={cn(
                        'font-mono text-[12px]',
                        settings.confirmMultilinePaste ? 'text-body' : 'text-faint'
                      )}
                    >
                      {settings.confirmMultilinePaste
                        ? t('common.enabled')
                        : t('common.disabled')}
                    </span>
                    <SettingToggle
                      checked={settings.confirmMultilinePaste}
                      label={t('settings.confirmMultilinePaste')}
                      onChange={(confirmMultilinePaste) => patch({ confirmMultilinePaste })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="interface">
            <SettingsSection title={t('settings.interface')} showTitle={false}>
              <div className="settings-form-grid">
                <div>
                  <Label htmlFor="settings-language">{t('settings.language')}</Label>
                  <SettingSelect
                    id="settings-language"
                    value={settings.language}
                    options={[
                      { value: 'system', label: t('settings.langSystem') },
                      { value: 'zh-CN', label: t('settings.langZh') },
                      { value: 'en-US', label: t('settings.langEn') }
                    ]}
                    onChange={(language) =>
                      patch({ language: language as AppSettings['language'] })
                    }
                  />
                </div>
                <div>
                  <Label>{t('settings.showSessionInfoBar')}</Label>
                  <div className="settings-control-surface h-9 flex items-center justify-between gap-4 px-2.5 rounded-sm border">
                    <span
                      className={cn(
                        'font-mono text-[12px]',
                        settings.showSessionInfoBar ? 'text-body' : 'text-faint'
                      )}
                    >
                      {settings.showSessionInfoBar ? t('common.enabled') : t('common.disabled')}
                    </span>
                    <SettingToggle
                      checked={settings.showSessionInfoBar}
                      label={t('settings.showSessionInfoBar')}
                      onChange={(showSessionInfoBar) => patch({ showSessionInfoBar })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="transfer">
            <SettingsSection title={t('settings.transferSaveLocation')}>
              <div className="flex max-w-[560px] flex-col gap-3">
                <div>
                  <Label>{t('settings.downloadDir')}</Label>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                    <div
                      className="settings-control-surface min-w-0 h-9 flex items-center px-2.5 rounded-sm border font-mono text-[11px] text-faint"
                      title={settings.downloadDir || undefined}
                    >
                      <span className="truncate">
                        {settings.downloadDir || t('settings.downloadDirAsk')}
                      </span>
                    </div>
                    <Button
                      className="h-9 shrink-0"
                      onClick={async () => {
                        const dir = await window.api.dialog.pickDirectory()
                        if (dir) patch({ downloadDir: dir })
                      }}
                    >
                      {t('common.browse')}
                    </Button>
                    <Button
                      size="icon"
                      className="size-9 shrink-0"
                      title={t('settings.downloadDirReset')}
                      aria-label={t('settings.downloadDirReset')}
                      disabled={!settings.downloadDir}
                      onClick={() => patch({ downloadDir: '' })}
                    >
                      <RotateCcw />
                    </Button>
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.transferFileConflict')}>
              <div className="flex max-w-[560px] flex-col gap-3">
                <div>
                  <Label htmlFor="download-conflict-policy">{t('settings.downloadConflict')}</Label>
                  <SettingSelect
                    id="download-conflict-policy"
                    value={settings.downloadConflictPolicy}
                    options={[
                      { value: 'ask', label: t('settings.conflictAsk') },
                      { value: 'overwrite', label: t('settings.conflictOverwrite') },
                      { value: 'skip', label: t('settings.conflictSkip') },
                      { value: 'rename', label: t('settings.conflictRename') }
                    ]}
                    onChange={(downloadConflictPolicy) =>
                      patch({
                        downloadConflictPolicy:
                          downloadConflictPolicy as AppSettings['downloadConflictPolicy']
                      })
                    }
                  />
                </div>
                <div>
                  <Label>{t('settings.uploadConflict')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-3">
                    <div className="settings-control-title">
                      {settings.confirmUploadOverwrite
                        ? t('settings.confirmBeforeOverwrite')
                        : t('settings.overwriteDirectly')}
                    </div>
                    <SettingToggle
                      checked={settings.confirmUploadOverwrite}
                      label={t('settings.uploadConflict')}
                      onChange={(confirmUploadOverwrite) => patch({ confirmUploadOverwrite })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.transferPanelSettings')}>
              <div className="settings-form-grid">
                <div>
                  <Label htmlFor="sftp-panel-mode">{t('settings.panelMode')}</Label>
                  <SettingSelect
                    id="sftp-panel-mode"
                    value={settings.sftpPanelMode}
                    options={[
                      { value: 'panel', label: t('settings.panelView') },
                      { value: 'split', label: t('settings.splitView') }
                    ]}
                    onChange={(sftpPanelMode) =>
                      patch({ sftpPanelMode: sftpPanelMode as AppSettings['sftpPanelMode'] })
                    }
                  />
                </div>
                <div>
                  <Label>{t('settings.doubleClickUpload')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-3">
                    <div className="settings-control-title">
                      {settings.doubleClickUpload ? t('common.enabled') : t('common.disabled')}
                    </div>
                    <SettingToggle
                      checked={settings.doubleClickUpload}
                      label={t('settings.doubleClickUpload')}
                      onChange={(doubleClickUpload) => patch({ doubleClickUpload })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.transferQueue')}>
              <div className="settings-form-grid">
                <div>
                  <Label htmlFor="max-concurrent-transfers">{t('settings.concurrentTasks')}</Label>
                  <NumericSetting
                    id="max-concurrent-transfers"
                    value={settings.maxConcurrentTransfers}
                    min={1}
                    max={4}
                    step={1}
                    integer
                    onChange={(maxConcurrentTransfers) => patch({ maxConcurrentTransfers })}
                  />
                </div>
                <div>
                  <Label>{t('settings.completionNotice')}</Label>
                  <div className="settings-control-surface flex h-9 items-center justify-between gap-4 rounded-sm border px-3">
                    <div className="settings-control-title">
                      {settings.notifyTransferComplete ? t('common.enabled') : t('common.disabled')}
                    </div>
                    <SettingToggle
                      checked={settings.notifyTransferComplete}
                      label={t('settings.completionNotice')}
                      onChange={(notifyTransferComplete) => patch({ notifyTransferComplete })}
                    />
                  </div>
                </div>
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="backup">
            <SettingsSection title={t('settings.hostBackup')} showTitle={false}>
              <div className="flex max-w-[560px] flex-col gap-3">
                <div className="settings-section-heading">
                  <h2 className="settings-section-title">{t('settings.hostBackupLabel')}</h2>
                  <p className="settings-section-description">
                    {t('settings.hostBackupBaseHint')}
                  </p>
                </div>
                <div className="settings-control-surface flex min-h-12 items-center justify-between gap-4 rounded-sm border px-3 py-2">
                  <div className="min-w-0">
                    <div className="settings-control-title">
                      {t('settings.includeCredentials')}
                    </div>
                    <div className="settings-control-description">
                      {includeCredentials
                        ? t('settings.encryptedBackupHint')
                        : t('settings.hostBackupHint')}
                    </div>
                  </div>
                  <SettingToggle
                    checked={includeCredentials}
                    emphasized
                    label={t('settings.includeCredentials')}
                    onChange={(backupIncludeCredentials) => patch({ backupIncludeCredentials })}
                  />
                </div>
                {includeCredentials && backupStats && (
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[10px] leading-4 text-ghost">
                    <span>{t('settings.backupHosts', { count: backupStats.hosts })}</span>
                    <span>{t('settings.backupPasswords', { count: backupStats.passwords })}</span>
                    <span>{t('settings.backupKeys', { count: backupStats.keys })}</span>
                    <span>
                      {t('settings.backupPassphrases', { count: backupStats.passphrases })}
                    </span>
                  </div>
                )}
                <div className="settings-backup-actions grid gap-3">
                  <Button className="w-full" onClick={() => void exportBackup()}>
                    <Download data-icon="inline-start" />
                    {t('settings.exportBackup')}
                  </Button>
                  <Button className="w-full" onClick={() => void importBackup()}>
                    <Upload data-icon="inline-start" />
                    {t('settings.importBackup')}
                  </Button>
                </div>
              </div>
            </SettingsSection>

            <Dialog
              open={backupPasswordMode !== null}
              onOpenChange={(open) => {
                if (!open && !backupBusy) void closePasswordDialog()
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {backupPasswordMode === 'export'
                      ? t('settings.encryptedExportTitle')
                      : t('settings.encryptedImportTitle')}
                  </DialogTitle>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3.5">
                  <p className="font-mono text-[10px] leading-4 text-ghost">
                    {backupPasswordMode === 'export'
                      ? t('settings.encryptedExportWarning')
                      : t('settings.encryptedImportWarning')}
                  </p>
                  {backupPasswordMode === 'export' && (
                    <div>
                      <Label>{t('settings.backupPasswordSource')}</Label>
                      <Tabs
                        value={backupPasswordSource}
                        onValueChange={(value) =>
                          selectBackupPasswordSource(value as 'custom' | 'random')
                        }
                      >
                        <TabsList
                          className="h-9 w-full"
                          aria-label={t('settings.backupPasswordSource')}
                        >
                          <TabsTrigger value="custom">
                            {t('settings.customBackupPassword')}
                          </TabsTrigger>
                          <TabsTrigger value="random">
                            {t('settings.randomBackupPassword')}
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="backup-password">
                      {backupPasswordMode === 'export' && backupPasswordSource === 'random'
                        ? t('settings.generatedBackupPassword')
                        : t('settings.backupPassword')}
                    </Label>
                    {backupPasswordMode === 'export' && backupPasswordSource === 'random' ? (
                      <div className="grid grid-cols-[minmax(0,1fr)_36px_36px] gap-2">
                        <Input
                          id="backup-password"
                          type="text"
                          readOnly
                          value={backupPassword}
                          className="font-mono text-dim"
                        />
                        <Button
                          type="button"
                          size="icon"
                          className="size-9"
                          aria-label={t('settings.copyRandomBackupPassword')}
                          title={t('settings.copyRandomBackupPassword')}
                          onClick={() => void copyBackupPassword(backupPassword)}
                        >
                          <Copy data-icon="inline-start" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          className="size-9"
                          aria-label={t('settings.refreshRandomBackupPassword')}
                          title={t('settings.refreshRandomBackupPassword')}
                          onClick={generateBackupPasswordValue}
                        >
                          <RefreshCw data-icon="inline-start" />
                        </Button>
                      </div>
                    ) : (
                      <Input
                        id="backup-password"
                        type="password"
                        autoComplete="new-password"
                        value={backupPassword}
                        onChange={(event) => setBackupPassword(event.currentTarget.value)}
                      />
                    )}
                  </div>
                  {backupPasswordMode === 'export' && backupPasswordSource === 'custom' && (
                    <div>
                      <Label htmlFor="backup-password-confirm">
                        {t('settings.backupPasswordConfirm')}
                      </Label>
                      <Input
                        id="backup-password-confirm"
                        type="password"
                        autoComplete="new-password"
                        value={backupPasswordConfirm}
                        onChange={(event) => setBackupPasswordConfirm(event.currentTarget.value)}
                      />
                    </div>
                  )}
                </DialogBody>
                <DialogFooter className="justify-end">
                  <Button disabled={backupBusy} onClick={() => void closePasswordDialog()}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="solid"
                    disabled={backupBusy}
                    onClick={() => void submitBackupPassword()}
                  >
                    {backupPasswordMode === 'export'
                      ? t('settings.exportBackup')
                      : t('settings.unlockBackup')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog
              open={importPreview !== null}
              onOpenChange={(open) => {
                if (!open && !backupBusy) {
                  setImportPreview(null)
                  void window.api.hosts.cancelEncryptedBackup()
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.encryptedImportPreviewTitle')}</DialogTitle>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3.5">
                  <p className="font-mono text-[10px] leading-4 text-ghost">
                    {t('settings.encryptedImportPreviewHint')}
                  </p>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-dim">
                    <span>{t('settings.backupHosts', { count: importPreview?.hosts ?? 0 })}</span>
                    <span>{t('settings.backupPasswords', { count: importPreview?.passwords ?? 0 })}</span>
                    <span>{t('settings.backupKeys', { count: importPreview?.keys ?? 0 })}</span>
                    <span>{t('settings.backupPassphrases', { count: importPreview?.passphrases ?? 0 })}</span>
                  </div>
                </DialogBody>
                <DialogFooter className="justify-end max-[420px]:flex-wrap">
                  <Button
                    disabled={backupBusy}
                    onClick={() => {
                      setImportPreview(null)
                      void window.api.hosts.cancelEncryptedBackup()
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button disabled={backupBusy} onClick={() => void commitEncryptedImport('merge')}>
                    {t('settings.importMerge')}
                  </Button>
                  <Button
                    variant="solid"
                    disabled={backupBusy}
                    onClick={() => void commitEncryptedImport('replace')}
                  >
                    {t('settings.importReplace')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="sync">
            <SettingsSection
              title={t('settings.syncConnection')}
              description={t('settings.syncConnectionHint')}
            >
              <div className="flex max-w-[560px] flex-col gap-3">
                <div className="settings-form-grid">
                  <div className="settings-form-wide">
                    <Label htmlFor="sync-host">{t('settings.syncHost')}</Label>
                    <Input
                      id="sync-host"
                      value={syncForm.host}
                      placeholder="db.xxxx.supabase.co"
                      autoComplete="off"
                      onChange={(event) => updateSyncField('host', event.currentTarget.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sync-port">{t('settings.syncPort')}</Label>
                    <Input
                      id="sync-port"
                      inputMode="numeric"
                      value={syncForm.port}
                      autoComplete="off"
                      onChange={(event) => updateSyncField('port', event.currentTarget.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sync-database">{t('settings.syncDatabase')}</Label>
                    <Input
                      id="sync-database"
                      value={syncForm.database}
                      placeholder="postgres"
                      autoComplete="off"
                      onChange={(event) => updateSyncField('database', event.currentTarget.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sync-user">{t('settings.syncUser')}</Label>
                    <Input
                      id="sync-user"
                      value={syncForm.user}
                      placeholder="postgres"
                      autoComplete="off"
                      onChange={(event) => updateSyncField('user', event.currentTarget.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sync-password">{t('settings.syncPassword')}</Label>
                    <Input
                      id="sync-password"
                      type="password"
                      autoComplete="new-password"
                      value={syncForm.password}
                      placeholder={
                        syncState?.configured ? t('settings.syncPasswordSaved') : undefined
                      }
                      onChange={(event) => updateSyncField('password', event.currentTarget.value)}
                    />
                  </div>
                </div>
                <div className="settings-backup-actions grid gap-3">
                  <Button
                    className="w-full"
                    disabled={syncBusy}
                    onClick={() => void saveSyncConnection()}
                  >
                    {t('settings.syncSaveConnection')}
                  </Button>
                  <Button
                    className="w-full"
                    disabled={syncBusy}
                    onClick={() => void testSyncConnection()}
                  >
                    {t('settings.syncTestConnection')}
                  </Button>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              title={t('settings.syncKeySection')}
              description={t('settings.syncKeyHint')}
            >
              <div className="flex max-w-[560px] flex-col gap-3">
                <div className="settings-control-surface flex min-h-12 items-center justify-between gap-4 rounded-sm border px-3 py-2">
                  <div className="min-w-0">
                    <div className="settings-control-title">
                      {syncState?.hasKey
                        ? t('settings.syncKeyConfigured')
                        : t('settings.syncKeyNotConfigured')}
                    </div>
                  </div>
                </div>
                <div>
                  <Label>{t('settings.syncKeySource')}</Label>
                  <Tabs
                    value={syncKeySource}
                    onValueChange={(value) =>
                      setSyncKeySource(value as 'generate' | 'existing')
                    }
                  >
                    <TabsList className="h-9 w-full" aria-label={t('settings.syncKeySource')}>
                      <TabsTrigger value="generate">{t('settings.syncGenerateMode')}</TabsTrigger>
                      <TabsTrigger value="existing">{t('settings.syncExistingMode')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                {syncKeySource === 'generate' ? (
                  <div
                    className="settings-backup-actions grid gap-3"
                    data-count={syncGeneratedCopyAvailable ? '2' : '1'}
                  >
                    {syncGeneratedCopyAvailable && (
                      <Button disabled={syncBusy} onClick={() => void copyGeneratedSyncKey()}>
                        <Copy data-icon="inline-start" />
                        {t('settings.syncCopyKeyOnce')}
                      </Button>
                    )}
                    <Button
                      disabled={syncBusy}
                      onClick={() =>
                        syncState?.hasKey ? setRegenKeyAsk(true) : void generateSyncKey()
                      }
                    >
                      <RefreshCw data-icon="inline-start" />
                      {syncState?.hasKey
                        ? t('settings.syncRegenerateKey')
                        : t('settings.syncGenerateKey')}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="sync-key-input">{t('settings.syncKeyInput')}</Label>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input
                      id="sync-key-input"
                      type="password"
                      autoComplete="off"
                      value={syncKeyInput}
                      placeholder={t('settings.syncKeyPlaceholder')}
                      onChange={(event) => setSyncKeyInput(event.currentTarget.value)}
                    />
                    <Button
                      className="h-9 shrink-0"
                      disabled={syncBusy || !syncKeyInput.trim()}
                      onClick={() => void submitSyncKey()}
                    >
                      {t('settings.syncUseKey')}
                    </Button>
                    </div>
                  </div>
                )}
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.syncSection')}>
              <div className="flex max-w-[560px] flex-col gap-3">
                <div className="settings-control-surface flex min-h-12 items-center justify-between gap-4 rounded-sm border px-3 py-2">
                  <div className="min-w-0">
                    <div className="settings-control-title">
                      {t('settings.syncEnable')}
                    </div>
                    <div className="settings-control-description">
                      {t('settings.syncEnabledHint')}
                    </div>
                  </div>
                  <SettingToggle
                    checked={syncState?.enabled ?? false}
                    emphasized
                    label={t('settings.syncEnable')}
                    onChange={(enabled) => void toggleSyncEnabled(enabled)}
                  />
                </div>
                <div className="font-mono text-[11px] leading-4 text-dim break-all">
                  {syncStatusText()}
                </div>
                {syncState?.lastResult && (
                  <div className="font-mono text-[10px] leading-4 text-ghost">
                    {t('settings.syncResult', {
                      pushed: syncState.lastResult.pushed,
                      pulled: syncState.lastResult.pulled,
                      deleted: syncState.lastResult.deleted,
                      skipped: syncState.lastResult.skipped,
                      conflicts: syncState.lastResult.conflicts
                    })}
                  </div>
                )}
                <div className="settings-backup-actions grid gap-3">
                  <Button
                    className="w-full"
                    disabled={syncBusy || !syncState?.enabled || syncState.syncing}
                    onClick={() => void runSyncAction(window.api.cloudSync.syncNow)}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {t('settings.syncNow')}
                  </Button>
                  <Button
                    className="w-full"
                    disabled={syncBusy || !syncState?.configured}
                    onClick={() => setClearRemoteAsk(true)}
                  >
                    {t('settings.syncClearRemote')}
                  </Button>
                </div>
              </div>
            </SettingsSection>

            {/* 重新生成密钥确认：云端密文将被清空重写 */}
            <Dialog open={regenKeyAsk} onOpenChange={setRegenKeyAsk}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.syncRegenerateConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <p className="font-mono text-[11px] text-dim leading-relaxed">
                    {t('settings.syncRegenerateConfirmDesc')}
                  </p>
                </DialogBody>
                <DialogFooter className="justify-end">
                  <Button size="sm" onClick={() => setRegenKeyAsk(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="solid"
                    disabled={syncBusy}
                    onClick={() => void generateSyncKey()}
                  >
                    {t('settings.syncRegenerateConfirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* 清空云端数据确认 */}
            <Dialog open={clearRemoteAsk} onOpenChange={setClearRemoteAsk}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.syncClearConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <p className="font-mono text-[11px] text-dim leading-relaxed">
                    {t('settings.syncClearConfirmDesc')}
                  </p>
                </DialogBody>
                <DialogFooter className="justify-end">
                  <Button size="sm" onClick={() => setClearRemoteAsk(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="solid"
                    disabled={syncBusy}
                    onClick={() => void clearRemote()}
                  >
                    {t('settings.syncClearConfirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="about">
            <SettingsSection title={t('settings.about')} showTitle={false}>
              <div className="settings-control-surface flex min-h-14 max-w-[560px] items-center gap-3 rounded-sm border px-3">
                <img src={logoUrl} alt="" className="size-7 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] text-fg">Apex SSH</div>
                  <div className="settings-control-description truncate">
                    {t('settings.aboutDesc')}
                  </div>
                </div>
                <div className="font-mono text-[10px] text-faint shrink-0">
                  {t('settings.version')} {updateStatus?.currentVersion ?? '…'}
                </div>
              </div>

              <div className="settings-control-surface flex max-w-[560px] flex-col gap-2.5 rounded-sm border px-3 py-3">
                <div className="settings-section-title">
                  {t('settings.update')}
                </div>
                <div className="font-mono text-[11px] leading-4 text-dim break-all">
                  {updateStatusText()}
                </div>
                {updateStatus?.state === 'downloading' && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full bg-white/25 transition-[width]"
                      style={{ width: `${updateStatus.progress ?? 0}%` }}
                    />
                  </div>
                )}
                {updateStatus?.supported && updateStatus.state !== 'installing' && (
                  <div
                    className="settings-update-actions grid w-full gap-2"
                    data-count={updateStatus.state === 'downloaded' ? 2 : 1}
                  >
                    {updateStatus.state !== 'checking' && updateStatus.state !== 'downloading' && (
                      <Button
                        className="h-9 w-full"
                        onClick={() => void window.api.updater.check()}
                      >
                        <RefreshCw data-icon="inline-start" />
                        {updateStatus.state === 'error'
                          ? t('settings.updateRetry')
                          : t('settings.checkUpdate')}
                      </Button>
                    )}
                    {updateStatus.state === 'downloaded' && (
                      <Button
                        className="h-9 w-full"
                        variant="solid"
                        onClick={() => {
                          // 存在活动 SSH 会话时必须先确认会断开，再允许立即安装
                          if (activeSessions > 0) setRestartAsk(true)
                          else void window.api.updater.restartAndInstall()
                        }}
                      >
                        <Rocket data-icon="inline-start" />
                        {t('settings.restartNow')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </SettingsSection>

            {/* 立即重启更新确认：活动 SSH 会话将断开 */}
            <Dialog open={restartAsk} onOpenChange={setRestartAsk}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.restartConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <p className="font-mono text-[11px] text-dim leading-relaxed">
                    {t('settings.restartConfirmDesc', { count: activeSessions })}
                  </p>
                </DialogBody>
                <DialogFooter className="justify-end">
                  <Button size="sm" onClick={() => setRestartAsk(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="solid"
                    onClick={() => {
                      setRestartAsk(false)
                      void window.api.updater.restartAndInstall()
                    }}
                  >
                    {t('settings.restartConfirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}
