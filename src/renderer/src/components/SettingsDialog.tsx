import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  CloudUpload,
  Copy,
  Check,
  KeyRound,
  Unplug,
  DatabaseBackup,
  Download,
  FolderDown,
  FolderOpen,
  Info,
  MonitorCog,
  Minus,
  Plus,
  PlugZap,
  RefreshCw,
  Rocket,
  Save,
  SquareTerminal,
  Trash2,
  Upload,
  X,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { ScrollArea } from 'radix-ui'
import type {
  AppSettings,
  CloudSyncConnectionInput,
  CloudSyncState,
  EncryptedBackupStats,
  UpdateStatus
} from '@shared/types'
import logoUrl from '@/assets/logo.svg'
import githubUrl from '@/assets/github.svg'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { SettingsConfirmation } from '@/components/SettingsConfirmation'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Dialog,
  DialogClose,
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
    <Switch
      checked={checked}
      emphasized={emphasized}
      aria-label={label}
      onCheckedChange={onChange}
    />
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
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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

type SettingsCategory = 'terminal' | 'interface' | 'monitor' | 'transfer' | 'backup' | 'sync' | 'about'

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
  const [backupCopyBusy, setBackupCopyBusy] = useState(false)
  const [backupCopied, setBackupCopied] = useState(false)
  useEffect(() => {
    if (!backupCopied) return
    const timer = setTimeout(() => setBackupCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [backupCopied])
  const [importPreview, setImportPreview] = useState<EncryptedBackupStats | null>(null)
  const [importStrategy, setImportStrategy] = useState<'merge' | 'replace'>('merge')
  const [syncState, setSyncState] = useState<CloudSyncState | null>(null)
  const [syncForm, setSyncForm] = useState({
    host: '',
    port: '5432',
    database: '',
    user: '',
    password: ''
  })
  const [syncKeyInput, setSyncKeyInput] = useState('')
  const [generatedSyncKey, setGeneratedSyncKey] = useState<string | null>(null)
  const [syncKeyMasked, setSyncKeyMasked] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncKeyCopied, setSyncKeyCopied] = useState(false)
  useEffect(() => {
    if (category !== 'sync') {
      setGeneratedSyncKey(null)
      setSyncKeyInput('')
      setSyncKeyCopied(false)
    }
  }, [category])
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

  useEffect(() => {
    if (syncState?.hasKey && !generatedSyncKey && !syncKeyInput) setSyncKeyMasked(true)
  }, [generatedSyncKey, syncKeyInput, syncState?.hasKey])

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
      id: 'monitor',
      label: t('settings.monitor'),
      description: t('settings.monitorDescription'),
      icon: Activity
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
    if (backupBusy || backupCopyBusy) return
    setBackupCopied(false)
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
    if (backupCopyBusy) return
    setBackupCopyBusy(true)
    const toastId = 'backup-password-copy'
    try {
      const copied = await window.api.clipboard.writeText(password)
      if (copied) {
        setBackupCopied(true)
        toast.success(t('settings.randomBackupPasswordCopied'), { id: toastId })
      } else {
        toast.error(t('settings.randomBackupPasswordCopyFailed'), { id: toastId })
      }
    } catch {
      toast.error(t('settings.randomBackupPasswordCopyFailed'), { id: toastId })
    } finally {
      setBackupCopyBusy(false)
    }
  }

  const generateBackupPasswordValue = () => {
    if (backupCopyBusy) return
    setBackupCopied(false)
    const password = generateBackupPassword()
    setBackupPassword(password)
    setBackupPasswordConfirm('')
  }

  const selectBackupPasswordSource = (source: 'custom' | 'random') => {
    if (backupCopyBusy || backupBusy) return
    if (backupPasswordSource === source) return
    patch({ backupPasswordSource: source })
    setBackupPassword('')
    setBackupPasswordConfirm('')
    if (source === 'random') generateBackupPasswordValue()
  }

  const submitBackupPassword = async () => {
    if (backupBusy || backupCopyBusy) return
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
      const result = await window.api.cloudSync.generateKey()
      setGeneratedSyncKey(result.key)
      setSyncKeyCopied(false)
      setSyncKeyInput('')
      setSyncKeyMasked(false)
      if (result.copyAvailable) toast.success(t('settings.syncKeyGenerated'))
      if (result.error) toast.error(t('settings.syncFailed', { message: result.error }))
    } catch (error) {
      toast.error(t('settings.syncFailed', { message: String(error) }))
    } finally {
      setSyncBusy(false)
    }
  }

  const copyGeneratedSyncKey = async () => {
    if (syncBusy || !generatedSyncKey) return
    setSyncBusy(true)
    try {
      const copied = await window.api.cloudSync.copyGeneratedKey()
      if (copied) {
        setGeneratedSyncKey(null)
        setSyncKeyInput('')
        setSyncKeyMasked(true)
        setSyncKeyCopied(true)
        toast.success(t('settings.syncKeyCopied'))
      } else toast.error(t('settings.syncKeyCopyFailed'))
    } catch {
      toast.error(t('settings.syncKeyCopyFailed'))
    } finally {
      setSyncBusy(false)
    }
  }

  const submitSyncKey = () =>
    runSyncAction(async () => {
      const error = await window.api.cloudSync.setKey(syncKeyInput)
      if (!error) {
        setSyncKeyInput('')
        setSyncKeyMasked(true)
      }
      return error
    }, 'settings.syncKeySaved')

  const updateSyncKey = () => {
    if (generatedSyncKey) {
      void copyGeneratedSyncKey()
    } else if (syncKeyInput.trim()) {
      void submitSyncKey()
    } else if (syncKeyMasked || syncState?.hasKey) {
      setRegenKeyAsk(true)
    } else {
      void generateSyncKey()
    }
  }

  const syncKeyActionLabel = generatedSyncKey
    ? t('settings.syncCopyKeyOnce')
    : syncKeyInput.trim()
      ? t('settings.syncUseKey')
      : syncKeyMasked || syncState?.hasKey
        ? t('settings.syncRegenerateKey')
        : t('settings.syncGenerateKey')
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
      data-category={category}
    >
      <TabsList variant="settings" aria-label={t('settings.title')}>
        <div className="settings-navigation-title">
          <img src={logoUrl} alt="" />
          <span>APEX SSH</span>
        </div>
        {categories.map(({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id} variant="settings">
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="settings-workspace-main">
        <header className="settings-workspace-header">
          <div className="min-w-0 flex-1">
            <h1 className="settings-page-title">
              {activeCategory.label}
            </h1>
            <p className="settings-page-description">
              {activeCategory.description}
            </p>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="settings-close" aria-label={t('common.close')} title={t('common.close')}>
              <X />
            </Button>
          </DialogClose>
        </header>

        <ScrollArea.Root className="settings-scroll-area" type="auto">
        <ScrollArea.Viewport className="settings-workspace-content">
        <div className="settings-scroll-inner">
          <TabsContent value="terminal" className="terminal-settings">
              <SettingsSection
                title={t('settings.fontGroup')}
                description={t('settings.fontGroupDescription')}
              >
                <div className="terminal-setting-row">
                  <div>
                    <div className="terminal-setting-label">{t('settings.fontSize')}</div>
                    <p className="settings-control-description">
                      {t('settings.fontSizeDescription')}
                    </p>
                  </div>
                  <div className="terminal-font-stepper">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.decreaseValue')}
                      title={t('common.decreaseValue')}
                      disabled={settings.fontSize <= 12.5}
                      onClick={() =>
                        patch({
                          fontSize: Math.max(12.5, settings.fontSize - 0.5)
                        })
                      }
                    >
                      <Minus />
                    </Button>
                    <output aria-label={t('settings.fontSize')}>{settings.fontSize}</output>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.increaseValue')}
                      title={t('common.increaseValue')}
                      disabled={settings.fontSize >= 24}
                      onClick={() =>
                        patch({
                          fontSize: Math.min(24, settings.fontSize + 0.5)
                        })
                      }
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
              </SettingsSection>
              <SettingsSection
                title={t('settings.cursorGroup')}
                description={t('settings.cursorGroupDescription')}
              >
                <div className="terminal-select-field">
                  <Label htmlFor="settings-cursor-style">{t('settings.cursorStyle')}</Label>
                  <SettingSelect
                    id="settings-cursor-style"
                    value={settings.cursorStyle}
                    options={[
                      { value: 'block', label: t('settings.cursorBlock') },
                      {
                        value: 'underline',
                        label: t('settings.cursorUnderline')
                      },
                      { value: 'bar', label: t('settings.cursorBar') }
                    ]}
                    onChange={(cursorStyle) =>
                      patch({
                        cursorStyle: cursorStyle as AppSettings['cursorStyle']
                      })
                    }
                  />
                </div>
                <div className="terminal-setting-row">
                  <div>
                    <div className="terminal-setting-label">{t('settings.cursorBlink')}</div>
                    <p className="settings-control-description">
                      {t('settings.cursorBlinkDescription')}
                    </p>
                  </div>
                  <SettingToggle
                    checked={settings.cursorBlink}
                    label={t('settings.cursorBlink')}
                    onChange={(cursorBlink) => patch({ cursorBlink })}
                  />
                </div>
              </SettingsSection>
              <SettingsSection
                title={t('settings.scrollGroup')}
                description={t('settings.scrollGroupDescription')}
              >
                <div className="terminal-select-field terminal-scrollback">
                  <Label htmlFor="settings-scrollback">{t('settings.scrollback')}</Label>
                  <SettingSelect
                    id="settings-scrollback"
                    value={String(settings.scrollback)}
                    options={Array.from(new Set([1000, 5000, 10000, settings.scrollback]))
                      .sort((a, b) => a - b)
                      .map((value) => ({
                        value: String(value),
                        label: t('settings.scrollbackLines', {
                          value: value.toLocaleString('en-US')
                        })
                      }))}
                    onChange={(value) => patch({ scrollback: Number(value) })}
                  />
                </div>
                <div className="terminal-setting-row">
                  <div>
                    <div className="terminal-setting-label">{t('settings.scrollOnInput')}</div>
                    <p className="settings-control-description">
                      {t('settings.scrollOnInputDescription')}
                    </p>
                  </div>
                  <SettingToggle
                    checked={settings.scrollOnInput}
                    label={t('settings.scrollOnInput')}
                    onChange={(scrollOnInput) => patch({ scrollOnInput })}
                  />
                </div>
              </SettingsSection>
              <SettingsSection
                title={t('settings.interactionGroup')}
                description={t('settings.interactionGroupDescription')}
              >
                <div className="terminal-setting-row">
                  <div>
                    <div className="terminal-setting-label">{t('settings.copyOnSelect')}</div>
                    <p className="settings-control-description">
                      {t('settings.copyOnSelectDescription')}
                    </p>
                  </div>
                  <SettingToggle
                    checked={settings.copyOnSelect}
                    label={t('settings.copyOnSelect')}
                    onChange={(copyOnSelect) => patch({ copyOnSelect })}
                  />
                </div>
                <div className="terminal-setting-row">
                  <div>
                    <div className="terminal-setting-label">
                      {t('settings.confirmMultilinePaste')}
                    </div>
                    <p className="settings-control-description">
                      {t('settings.confirmMultilinePasteDescription')}
                    </p>
                  </div>
                  <SettingToggle
                    checked={settings.confirmMultilinePaste}
                    label={t('settings.confirmMultilinePaste')}
                    onChange={(confirmMultilinePaste) => patch({ confirmMultilinePaste })}
                  />
                </div>
              </SettingsSection>
            </TabsContent>

<TabsContent value="interface" className="settings-restored">
<SettingsSection title={t('settings.appearanceGroup')} ><div className="settings-form-grid"><div className="settings-preference-field "><Label htmlFor="settings-theme">{t('settings.theme')}</Label><Select value="dark" disabled><SelectTrigger id="settings-theme" title={t('settings.darkOnly')}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="dark">{t('settings.darkTheme')}</SelectItem></SelectGroup></SelectContent></Select></div><div className="settings-preference-field "><Label htmlFor="settings-language">{t('settings.language')}</Label><SettingSelect id="settings-language" value={String(settings.language)} options={[{ value: 'system', label: t('settings.langSystem') }, { value: 'zh-CN', label: t('settings.langZh') }, { value: 'en-US', label: t('settings.langEn') }]} onChange={(value) => patch({ language: value as AppSettings['language'] })} /></div></div></SettingsSection>
<SettingsSection title={t('settings.layoutGroup')} ><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.compactMode')}</div><p className="settings-control-description">{t('settings.compactModeDescription')}</p></div><SettingToggle checked={settings.compactMode} label={t('settings.compactMode')} onChange={(compactMode) => patch({ compactMode })} /></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.showTabBar')}</div><p className="settings-control-description">{t('settings.showTabBarDescription')}</p></div><span title={t('settings.notAvailable')}><Switch checked={true} disabled aria-label={t('settings.showTabBar')} /></span></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.interfaceAnimations')}</div><p className="settings-control-description">{t('settings.interfaceAnimationsDescription')}</p></div><SettingToggle checked={settings.interfaceAnimations} label={t('settings.interfaceAnimations')} onChange={(interfaceAnimations) => patch({ interfaceAnimations })} /></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.showSessionInfoBar')}</div><p className="settings-control-description">{t('settings.showSessionInfoBarDescription')}</p></div><SettingToggle checked={settings.showSessionInfoBar} label={t('settings.showSessionInfoBar')} onChange={(showSessionInfoBar) => patch({ showSessionInfoBar })} /></div></SettingsSection>
</TabsContent>

<TabsContent value="monitor" className="settings-restored">
<SettingsSection title={t('settings.monitorCollection')} description={t('settings.monitorCollectionDescription')}><div className="settings-preference-field settings-field-short"><Label htmlFor="settings-monitorRefreshInterval">{t('settings.monitorRefreshInterval')}</Label><p className="settings-control-description">{t('settings.monitorRefreshIntervalDescription')}</p><SettingSelect id="settings-monitorRefreshInterval" value={String(settings.monitorRefreshInterval)} options={Array.from(new Set([1,2,5,10,settings.monitorRefreshInterval])).sort((a,b)=>a-b).map(value=>({value:String(value), label:t('settings.intervalSeconds',{value})}))} onChange={(value) => patch({ monitorRefreshInterval: Number(value) })} /></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.monitorBackgroundEnabled')}</div><p className="settings-control-description">{t('settings.monitorBackgroundEnabledDescription')}</p></div><SettingToggle checked={settings.monitorBackgroundEnabled} label={t('settings.monitorBackgroundEnabled')} onChange={(monitorBackgroundEnabled) => patch({ monitorBackgroundEnabled })} /></div></SettingsSection>
<SettingsSection title={t('settings.monitorDisplay')} description={t('settings.monitorDisplayDescription')}><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.monitorEnabledByDefault')}</div><p className="settings-control-description">{t('settings.monitorEnabledByDefaultDescription')}</p></div><SettingToggle checked={settings.monitorEnabledByDefault} label={t('settings.monitorEnabledByDefault')} onChange={(monitorEnabledByDefault) => patch({ monitorEnabledByDefault })} /></div></SettingsSection>
</TabsContent>

<TabsContent value="transfer" className="settings-restored">
<SettingsSection title={t('settings.transferSaveLocation')} description={t('settings.transferFileDescription')}><div className="settings-preference-field"><Label>{t('settings.downloadDir')}</Label><p className="settings-control-description">{t('settings.downloadDirDescription')}</p><div className="settings-directory-row"><Input aria-label={t('settings.downloadDir')} readOnly value={settings.downloadDir} placeholder={t('settings.downloadDirAsk')} title={settings.downloadDir} disabled={settings.downloadDirectoryMode === 'ask'} /><Button variant="secondary" disabled={settings.downloadDirectoryMode === 'ask'} onClick={async () => { const dir = await window.api.dialog.pickDirectory(); if(dir) patch({ downloadDir: dir, downloadDirectoryMode: 'fixed' }) }}><FolderOpen data-icon="inline-start" />{t('settings.selectDirectory')}</Button></div><div className="settings-directory-options"><label><Checkbox checked={settings.downloadDirectoryMode === 'last'} onCheckedChange={(checked) => patch({downloadDirectoryMode: checked ? 'last' : 'fixed'})} />{t('settings.useLastDownloadDirectory')}</label><label><Checkbox checked={settings.downloadDirectoryMode === 'ask'} onCheckedChange={(checked) => patch({downloadDirectoryMode: checked ? 'ask' : 'fixed'})} />{t('settings.askDownloadDirectory')}</label></div></div><div className="settings-form-grid"><div className="settings-preference-field "><Label htmlFor="settings-downloadConflict">{t('settings.downloadConflict')}</Label><SettingSelect id="settings-downloadConflict" value={String(settings.downloadConflictPolicy)} options={[{value:'ask',label:t('settings.conflictAsk')},{value:'overwrite',label:t('settings.conflictOverwrite')},{value:'skip',label:t('settings.conflictSkip')},{value:'rename',label:t('settings.conflictRename')}]} onChange={(value) => patch({ downloadConflictPolicy: value as AppSettings['downloadConflictPolicy'] })} /></div><div className="settings-preference-field "><Label htmlFor="settings-uploadConflict">{t('settings.uploadConflict')}</Label><SettingSelect id="settings-uploadConflict" value={String(settings.uploadConflictPolicy)} options={[{value:'ask',label:t('settings.conflictAsk')},{value:'overwrite',label:t('settings.conflictOverwrite')},{value:'skip',label:t('settings.conflictSkip')},{value:'rename',label:t('settings.conflictRename')}]} onChange={(value) => patch({ uploadConflictPolicy: value as AppSettings['uploadConflictPolicy'] })} /></div></div></SettingsSection>
<SettingsSection title={t('settings.transferPanelSettings')} description={t('settings.transferPanelDescription')}><div className="settings-preference-field settings-field-medium"><Label htmlFor="settings-panelMode">{t('settings.panelMode')}</Label><SettingSelect id="settings-panelMode" value={String(settings.sftpPanelMode)} options={[{value:'panel',label:t('settings.panelView')},{value:'split',label:t('settings.splitView')}]} onChange={(value) => patch({ sftpPanelMode: value as AppSettings['sftpPanelMode'] })} /></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.doubleClickUpload')}</div><p className="settings-control-description">{t('settings.doubleClickUploadDescription')}</p></div><SettingToggle checked={settings.doubleClickUpload} label={t('settings.doubleClickUpload')} onChange={(doubleClickUpload) => patch({ doubleClickUpload })} /></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.showTransferProgress')}</div><p className="settings-control-description">{t('settings.showTransferProgressDescription')}</p></div><SettingToggle checked={settings.showTransferProgress} label={t('settings.showTransferProgress')} onChange={(showTransferProgress) => patch({ showTransferProgress })} /></div></SettingsSection>
<SettingsSection title={t('settings.transferQueue')} description={t('settings.transferQueueDescription')}><div className="settings-preference-field settings-field-short"><Label htmlFor="settings-concurrentTasks">{t('settings.concurrentTasks')}</Label><p className="settings-control-description">{t('settings.concurrentTasksDescription')}</p><SettingSelect id="settings-concurrentTasks" value={String(settings.maxConcurrentTransfers)} options={[1,2,3,4].map(value=>({value:String(value),label:String(value)}))} onChange={(value) => patch({ maxConcurrentTransfers: Number(value) })} /></div><div className="settings-preference-row"><div><div className="settings-preference-label">{t('settings.completionNotice')}</div><p className="settings-control-description">{t('settings.completionNoticeDescription')}</p></div><SettingToggle checked={settings.notifyTransferComplete} label={t('settings.completionNotice')} onChange={(notifyTransferComplete) => patch({ notifyTransferComplete })} /></div></SettingsSection>
</TabsContent>

          <TabsContent value="backup" className="settings-backup">
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
                  <Button variant="secondary" className="w-full" onClick={() => void exportBackup()}>
                    <Download data-icon="inline-start" />
                    {t('settings.exportBackup')}
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={() => void importBackup()}>
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
              <DialogContent className="settings-backup-dialog" onEscapeKeyDown={(event) => { if(backupBusy) event.preventDefault() }} onInteractOutside={(event) => event.preventDefault()}>
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
                      <ToggleGroup
                        type="single"
                        value={backupPasswordSource}
                        aria-label={t('settings.backupPasswordSource')}
                        onValueChange={(value) => {
                          if (value) selectBackupPasswordSource(value as 'custom' | 'random')
                        }}
                      >
                        <ToggleGroupItem value="custom">
                          {t('settings.customBackupPassword')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="random">
                          {t('settings.randomBackupPassword')}
                        </ToggleGroupItem>
                      </ToggleGroup>
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
                          {backupCopied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
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
                  <Button variant="ghost" disabled={backupBusy} onClick={() => void closePasswordDialog()}>
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
                  <div>
                    <Label>{t('settings.importMode')}</Label>
                    <ToggleGroup
                      type="single"
                      value={importStrategy}
                      aria-label={t('settings.importMode')}
                      onValueChange={(value) => {
                        if (value) setImportStrategy(value as 'merge' | 'replace')
                      }}
                    >
                      <ToggleGroupItem value="merge">{t('settings.importMerge')}</ToggleGroupItem>
                      <ToggleGroupItem value="replace">{t('settings.importReplace')}</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    disabled={backupBusy}
                    onClick={() => {
                      setImportPreview(null)
                      void window.api.hosts.cancelEncryptedBackup()
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="solid"
                    className="flex-1"
                    disabled={backupBusy}
                    onClick={() => void commitEncryptedImport(importStrategy)}
                  >
                    {t('settings.importBackup')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="sync" className="sync-settings">
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
                    variant="solid"
                    className="w-full"
                    disabled={syncBusy}
                    onClick={() => void saveSyncConnection()}
                  >
                    <Save data-icon="inline-start" />
                    {t('settings.syncSaveConnection')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full"
                    disabled={syncBusy}
                    onClick={() => void testSyncConnection()}
                  >
                    <Unplug data-icon="inline-start" />
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
                <span className="sync-key-badge">
                  {syncState?.hasKey ? t('settings.syncKeyConfigured') : t('settings.syncKeyNotConfigured')}
                </span>
                <div>
                  <Label htmlFor="sync-key-input" className="sr-only">{t('settings.syncKeyInput')}</Label>
                  <div className="settings-sync-key-row">
                    <Input
                      id="sync-key-input"
                      type={generatedSyncKey ? 'text' : 'password'}
                      autoComplete="off"
                      readOnly={Boolean(generatedSyncKey) || syncKeyMasked}
                      value={generatedSyncKey ?? syncKeyInput}
                      placeholder={
                        syncKeyMasked ? '****************' : t('settings.syncKeyPlaceholder')
                      }
                      onChange={(event) => setSyncKeyInput(event.currentTarget.value)}
                    />
                    {(syncState?.hasKey || generatedSyncKey || syncKeyMasked) && <>
                      <Button variant="icon" size="icon" disabled={syncBusy || !generatedSyncKey}
                        aria-label={t('settings.syncCopyKeyOnce')} title={t('settings.syncCopyKeyOnce')}
                        onClick={() => void copyGeneratedSyncKey()}>
                        {syncKeyCopied ? <Check /> : <Copy />}
                      </Button>
                      <Button variant="icon" size="icon" disabled={syncBusy}
                        aria-label={t('settings.syncRegenerateKey')} title={t('settings.syncRegenerateKey')}
                        onClick={() => setRegenKeyAsk(true)}><RefreshCw /></Button>
                    </>}
                  </div>
                  {!syncState?.hasKey && !generatedSyncKey && !syncKeyMasked && (
                    <Button variant="ghost" className="sync-generate" disabled={syncBusy} onClick={updateSyncKey}>
                      <KeyRound data-icon="inline-start" />{syncKeyActionLabel}
                    </Button>
                  )}
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('settings.syncSection')} description={t('settings.syncSectionHint')}>
              <div className="flex max-w-[560px] flex-col gap-3">
                <div className="sync-enable-row">
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
                    label={t('settings.syncEnable')}
                    onChange={(enabled) => void toggleSyncEnabled(enabled)}
                  />
                </div>
                <div className="sync-status-region">
                  <h3>{t('settings.syncStatusHeading')}</h3>
                  <div className="sync-status-card" role="status" title={syncStatusText()}>
                    <strong><RefreshCw aria-hidden="true" className={cn(syncState?.syncing && 'settings-status-spinning')} />
                      {t(syncState?.syncing ? 'settings.syncSyncing' : syncState?.errorCode ? 'settings.syncStatusError' : !syncState?.enabled ? 'settings.syncDisabled' : syncState?.lastSyncAt ? 'settings.syncStatusNormal' : 'settings.syncNever')}
                    </strong>
                    <div className="sync-status-time"><small>{t('settings.syncTimeLabel')}</small>
                      <span>{syncState?.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString('sv-SE') : '-'}</span>
                    </div>
                    <div className="sync-status-grid">
                      <span><small>{t('settings.syncHostCountLabel')}</small><b>{t('settings.syncHostCount', { count: syncState?.syncedHostCount ?? 0 })}</b></span>
                      <span><small>{t('settings.syncCloudLabel')}</small><b>{t(syncState?.errorCode ? 'settings.syncCloudError' : syncState?.lastSyncAt ? 'settings.syncCloudNormal' : 'settings.syncNever')}</b></span>
                    </div>
                  </div>
                </div>
                <div className="settings-backup-actions grid gap-3">
                  <Button
                    variant="solid"
                    className="w-full"
                    disabled={syncBusy || !syncState?.enabled || syncState.syncing}
                    onClick={() => void runSyncAction(async () => {
                      const before = await window.api.cloudSync.getState()
                      if (!before.enabled || before.syncing) return null
                      const error = await window.api.cloudSync.syncNow()
                      if (!error) {
                        const after = await window.api.cloudSync.getState()
                        if ((after.lastSyncAt ?? 0) > (before.lastSyncAt ?? 0)) {
                          toast.success(t('settings.syncCompleted'))
                        }
                      }
                      return error
                    })}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {t('settings.syncNow')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full"
                    disabled={syncBusy || !syncState?.configured}
                    onClick={() => setClearRemoteAsk(true)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t('settings.syncClearRemote')}
                  </Button>
                </div>
              </div>
            </SettingsSection>

            <SettingsConfirmation open={regenKeyAsk} onOpenChange={setRegenKeyAsk}
              title={t('settings.syncRegenerateConfirmTitle')} description={t('settings.syncRegenerateConfirmDesc')}
              action={t('settings.syncRegenerateConfirm')} busy={syncBusy} onConfirm={() => void generateSyncKey()} />
            <SettingsConfirmation open={clearRemoteAsk} onOpenChange={setClearRemoteAsk}
              title={t('settings.syncClearConfirmTitle')} description={t('settings.syncClearConfirmDesc')}
              action={t('settings.syncClearConfirm')} busy={syncBusy} onConfirm={() => void clearRemote()} />
          </TabsContent>

          <TabsContent value="about" className="settings-restored settings-about">
            <SettingsSection title={t('settings.appInfo')} showTitle={false}>
              <div className="settings-about-brand"><img src={logoUrl} alt="" /><div><h2>APEX SSH</h2><p className="settings-control-description">{t('settings.version')} v{updateStatus?.currentVersion ?? '...'}</p></div></div>
            </SettingsSection>
            <SettingsSection title={t('settings.update')} showTitle={false}>
              {updateStatus && updateStatus.state !== 'idle' && <p className="settings-update-status" role="status">{updateStatusText()}</p>}
              {updateStatus?.state === 'downloading' && <div className="settings-update-progress" role="progressbar" aria-label={t('settings.updateDownloadingButton')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, updateStatus.progress ?? 0))}><div style={{width: `${Math.min(100, Math.max(0, updateStatus.progress ?? 0))}%`}} /></div>}
              <div className="settings-update-actions">
                <Button variant="secondary" disabled={!updateStatus?.supported || ['checking','downloading','installing'].includes(updateStatus.state)} onClick={() => {
                  if(updateStatus?.state === 'downloaded') {
                    if(activeSessions > 0) setRestartAsk(true)
                    else void window.api.updater.restartAndInstall()
                  } else void window.api.updater.check()
                }}><RefreshCw data-icon="inline-start" className={cn(['checking','downloading'].includes(updateStatus?.state ?? '') && 'settings-status-spinning')} />{t(updateStatus?.state === 'downloaded' ? 'settings.restartNow' : updateStatus?.state === 'checking' ? 'settings.updateCheckingButton' : updateStatus?.state === 'downloading' ? 'settings.updateDownloadingButton' : updateStatus?.state === 'error' ? 'settings.updateRetry' : 'settings.checkUpdate')}</Button>
                <Button variant="secondary" onClick={() => void window.api.updater.openProject()}><img src={githubUrl} alt="" width={14} height={14} />GitHub</Button>
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
                  <Button variant="ghost" size="sm" onClick={() => setRestartAsk(false)}>
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
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" className="settings-scrollbar">
          <ScrollArea.Thumb className="settings-scrollbar-thumb" />
        </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
    </Tabs>
  )
}
