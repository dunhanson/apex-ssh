import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  DatabaseBackup,
  Download,
  FolderDown,
  Info,
  MonitorCog,
  SquareTerminal,
  Upload,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings } from '@shared/types'
import logoUrl from '@/assets/logo.svg'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSettings, setSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

interface SettingsWorkspaceProps {
  onHostsImported: () => Promise<void>
}

function SettingToggle({
  checked,
  label,
  onChange
}: {
  checked: boolean
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
        checked ? 'border-white/25 bg-white/[0.12]' : 'border-line-strong bg-elevated'
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'absolute top-[3px] size-3 rounded-full transition-[left,background-color]',
          checked ? 'left-[19px] bg-fg' : 'left-[3px] bg-faint'
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
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      className="h-9 font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      onChange={(event) => applyValidValue(event.currentTarget.value)}
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
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="font-mono text-[10px] leading-4 tracking-[0.08em] text-ghost uppercase">
        {title}
      </div>
      {children}
    </section>
  )
}

type SettingsCategory = 'terminal' | 'interface' | 'transfer' | 'backup' | 'about'

interface SettingsCategoryItem {
  id: SettingsCategory
  label: string
  description: string
  icon: LucideIcon
}

export function SettingsWorkspace({ onHostsImported }: SettingsWorkspaceProps) {
  const { t } = useTranslation()
  const settings = useSettings()
  const [category, setCategory] = useState<SettingsCategory>('terminal')
  const patch = (value: Partial<AppSettings>) => setSettings(value)
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
      id: 'about',
      label: t('settings.about'),
      description: t('settings.aboutDescription'),
      icon: Info
    }
  ]
  const activeCategory = categories.find((item) => item.id === category) ?? categories[0]

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
            <h1 className="font-sans text-base leading-6 font-semibold text-fg">
              {activeCategory.label}
            </h1>
            <p className="truncate font-sans text-[11px] leading-4 text-ghost">
              {activeCategory.description}
            </p>
          </div>
          <span className="ml-auto shrink-0 font-mono text-[11px] leading-4 text-ghost">
            {t('settings.autoApplied')}
          </span>
        </header>

        <div className="settings-workspace-content">
          <TabsContent value="terminal">
            <SettingsSection title={t('settings.terminal')}>
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
                <div className="settings-form-wide">
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
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="interface">
            <SettingsSection title={t('settings.interface')}>
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
                  <div className="h-9 flex items-center justify-between gap-4 px-2.5 bg-surface border border-line rounded-sm">
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
            <SettingsSection title={t('settings.transfer')}>
              <div className="max-w-[560px]">
                <Label>{t('settings.downloadDir')}</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <div
                    className="min-w-0 h-9 flex items-center px-2.5 bg-surface border border-line rounded-sm font-mono text-[11px] text-faint"
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
                </div>
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="backup">
            <SettingsSection title={t('settings.hostBackup')}>
              <div className="max-w-[560px]">
                <Label>{t('settings.hostBackupLabel')}</Label>
                <div className="max-w-[420px] mb-2.5 font-mono text-[10px] leading-4 text-ghost">
                  {t('settings.hostBackupHint')}
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={async () => {
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
                    }}
                  >
                    <Download data-icon="inline-start" />
                    {t('settings.exportBackup')}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={async () => {
                      try {
                        const result = await window.api.hosts.importBackup()
                        if (result.status === 'success') {
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
                    }}
                  >
                    <Upload data-icon="inline-start" />
                    {t('settings.importBackup')}
                  </Button>
                </div>
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="about">
            <SettingsSection title={t('settings.about')}>
              <div className="flex min-h-14 max-w-[520px] items-center gap-3 rounded-sm border border-line bg-surface px-3">
                <img src={logoUrl} alt="" className="size-7 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] text-fg">Apex SSH</div>
                  <div className="font-mono text-[10px] text-ghost truncate">
                    {t('settings.aboutDesc')}
                  </div>
                </div>
                <div className="font-mono text-[10px] text-faint shrink-0">
                  {t('settings.version')} 0.1.0
                </div>
              </div>
            </SettingsSection>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}
