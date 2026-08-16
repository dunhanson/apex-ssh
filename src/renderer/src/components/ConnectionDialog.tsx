import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Check, ChevronDown, FileKey, FolderOpen } from 'lucide-react'
import type { AuthConfig, HostConfig, HostInput, KeyEntry, PasswordMeta, SshConfigEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * 连接弹窗：新建 / 编辑双模式。
 * - 新建：保存并立即连接
 * - 编辑：回填现有配置，保存后仅更新持久化数据，不自动连接
 */
interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 从连接管理进入时提供返回入口；直接打开时不显示 */
  onBack?: () => void
  /** 编辑目标；null 表示新建 */
  host: HostConfig | null
  /** 提交：保存主机（主进程持久化） */
  onSubmit: (input: HostInput) => void
  /** 编辑提交：按 id 更新 */
  onUpdate?: (id: string, input: HostInput) => void
  /** 已存在的主机（SSH Config 导入时按 host+user 判重打标） */
  existingHosts: HostConfig[]
  /** 从启动器输入 user@host 时预填新建表单 */
  initialAddress?: { host: string; username: string } | null
  /** 从分组右键菜单新建连接时预填。 */
  initialGroup?: string | null
  /** 独立分组列表，包含尚无主机的空分组。 */
  availableGroups?: string[]
}

function ConnectionSelect({
  id,
  value,
  placeholder,
  options,
  onValueChange
}: {
  id?: string
  value: string
  placeholder?: string
  options: Array<{ value: string; label: string }>
  onValueChange: (value: string) => void
}) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
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

function authConfigToFields(auth: AuthConfig): {
  authType: 'password' | 'key'
  pwSource: 'direct' | 'store'
  password: string
  passwordId: string
  keySource: 'file' | 'store'
  privateKeyPath: string
  keyId: string
  passphrase: string
} {
  if (auth.type === 'password') {
    return {
      authType: 'password',
      pwSource: auth.passwordId ? 'store' : 'direct',
      password: auth.password ?? '',
      passwordId: auth.passwordId ?? '',
      keySource: 'file',
      privateKeyPath: '',
      keyId: '',
      passphrase: ''
    }
  }
  return {
    authType: 'key',
    pwSource: 'direct',
    password: '',
    passwordId: '',
    keySource: auth.keyId ? 'store' : 'file',
    privateKeyPath: auth.privateKeyPath ?? '',
    keyId: auth.keyId ?? '',
    passphrase: auth.passphrase ?? ''
  }
}

export function ConnectionDialog({
  open,
  onOpenChange,
  onBack,
  host,
  onSubmit,
  onUpdate,
  existingHosts,
  initialAddress,
  initialGroup,
  availableGroups = []
}: ConnectionDialogProps) {
  const { t } = useTranslation()
  const isEdit = host !== null

  const [hostValue, setHostValue] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [group, setGroup] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  const [authType, setAuthType] = useState<'password' | 'key'>('key')
  const [pwSource, setPwSource] = useState<'direct' | 'store'>('direct')
  const [password, setPassword] = useState('')
  const [passwordId, setPasswordId] = useState('')
  const [keySource, setKeySource] = useState<'file' | 'store'>('file')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [keyId, setKeyId] = useState('')
  const [passphrase, setPassphrase] = useState('')

  const [storeKeys, setStoreKeys] = useState<KeyEntry[]>([])
  const [storePasswords, setStorePasswords] = useState<PasswordMeta[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [configEntries, setConfigEntries] = useState<SshConfigEntry[] | null>(null)
  const groupOptions = useMemo(
    () =>
      [...new Set([
        ...availableGroups,
        ...existingHosts.map((item) => item.group?.trim()).filter((item): item is string => Boolean(item))
      ])]
        .sort((a, b) => a.localeCompare(b)),
    [availableGroups, existingHosts]
  )

  const reset = () => {
    setHostValue('')
    setPort('22')
    setUsername('')
    setLabel('')
    setDescription('')
    setGroup('')
    setGroupOpen(false)
    setPassword('')
    setPasswordId('')
    setPrivateKeyPath('')
    setKeyId('')
    setPassphrase('')
    setAuthType('key')
    setPwSource('direct')
    setKeySource('file')
  }

  const fillFromHost = (h: HostConfig) => {
    setHostValue(h.host)
    setPort(String(h.port))
    setUsername(h.username)
    setLabel(h.label)
    setDescription(h.description ?? '')
    setGroup(h.group ?? '')
    const fields = authConfigToFields(h.auth)
    setAuthType(fields.authType)
    setPwSource(fields.pwSource)
    setPassword(fields.password)
    setPasswordId(fields.passwordId)
    setKeySource(fields.keySource)
    setPrivateKeyPath(fields.privateKeyPath)
    setKeyId(fields.keyId)
    setPassphrase(fields.passphrase)
  }

  useEffect(() => {
    if (open) {
      window.api.creds.listKeys().then(setStoreKeys)
      window.api.creds.listPasswords().then(setStorePasswords)
      if (isEdit && host) {
        fillFromHost(host)
      } else {
        reset()
        if (initialAddress) {
          setHostValue(initialAddress.host)
          setUsername(initialAddress.username)
        }
        if (initialGroup) setGroup(initialGroup)
      }
    }
  }, [open, host, isEdit, initialAddress, initialGroup])

  const valid =
    hostValue.trim() !== '' &&
    username.trim() !== '' &&
    Number(port) > 0 &&
    (authType === 'password'
      ? pwSource === 'direct'
        ? password !== ''
        : passwordId !== ''
      : keySource === 'file'
        ? privateKeyPath !== ''
        : keyId !== '')

  const buildInput = (): HostInput => {
    const auth: AuthConfig =
      authType === 'password'
        ? pwSource === 'direct'
          ? { type: 'password', password }
          : { type: 'password', passwordId }
        : keySource === 'file'
          ? { type: 'key', privateKeyPath, passphrase: passphrase || undefined }
          : { type: 'key', keyId, passphrase: passphrase || undefined }
    return {
      label: label.trim(),
      description: description.trim() || undefined,
      host: hostValue.trim(),
      port: Number(port),
      username: username.trim(),
      group: group.trim() || undefined,
      auth
    }
  }

  const handleSubmit = () => {
    if (!valid) return
    const input = buildInput()
    if (isEdit && host && onUpdate) {
      onUpdate(host.id, input)
    } else {
      onSubmit(input)
    }
    reset()
  }

  const browseKey = async () => {
    const path = await window.api.dialog.pickFile()
    if (path) setPrivateKeyPath(path)
  }

  const openImport = async () => {
    const entries = await window.api.sshConfig.list()
    setConfigEntries(entries)
    setImportOpen(true)
  }

  const isDuplicate = (e: SshConfigEntry) =>
    existingHosts.some((h) => h.host === (e.hostname ?? e.alias) && h.username === (e.user ?? ''))

  const applyEntry = (e: SshConfigEntry) => {
    setLabel(e.alias)
    setHostValue(e.hostname ?? e.alias)
    setUsername(e.user ?? '')
    setPort(String(e.port ?? 22))
    if (e.identityFile) {
      setAuthType('key')
      setKeySource('file')
      setPrivateKeyPath(e.identityFile)
    }
    if (e.hasProxy) {
      toast.warning(t('import.proxyWarn', { alias: e.alias }))
    }
    setImportOpen(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader className="flex flex-row items-center gap-2.5 pr-12">
            {onBack && (
              <button
                className="icon-btn -ml-1"
                title={t('newConn.backToConnections')}
                aria-label={t('newConn.backToConnections')}
                onClick={onBack}
              >
                <ArrowLeft className="size-3.5" />
              </button>
            )}
            <DialogTitle>{isEdit ? t('newConn.editTitle') : t('newConn.title')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {/* SSH Config 导入入口：编辑模式下不显示 */}
            {!isEdit && (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-line-strong rounded-sm text-dim font-mono text-[11px] cursor-pointer outline-none transition-colors hover:border-white/20 hover:text-fg"
                onClick={openImport}
              >
                <FileKey className="size-3.5 shrink-0" />
                {t('newConn.importConfig')}
              </button>
            )}

            <div className="grid grid-cols-[1fr_96px] gap-2.5">
              <div>
                <Label htmlFor="nc-host">{t('newConn.host')}</Label>
                <Input
                  id="nc-host"
                  placeholder={t('newConn.hostPlaceholder')}
                  value={hostValue}
                  onChange={(e) => setHostValue(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="nc-port">{t('newConn.port')}</Label>
                <NumberInput
                  id="nc-port"
                  min={1}
                  max={65535}
                  step={1}
                  value={port}
                  incrementLabel={t('common.increaseValue')}
                  decrementLabel={t('common.decreaseValue')}
                  onValueChange={setPort}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label htmlFor="nc-username">{t('newConn.username')}</Label>
                <Input
                  id="nc-username"
                  placeholder={t('newConn.usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nc-label">{t('newConn.label')}</Label>
                <Input
                  id="nc-label"
                  placeholder={t('newConn.labelPlaceholder')}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            </div>
            <div
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setGroupOpen(false)
              }}
            >
              <Label htmlFor="nc-group">{t('newConn.group')}</Label>
              <div className="relative">
                <Input
                  id="nc-group"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={groupOpen}
                  aria-controls="nc-group-options"
                  placeholder={t('newConn.groupPlaceholder')}
                  value={group}
                  className="pr-9"
                  onChange={(e) => setGroup(e.target.value)}
                  onFocus={() => groupOptions.length > 0 && setGroupOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' && groupOptions.length > 0) {
                      event.preventDefault()
                      setGroupOpen(true)
                    }
                    if (event.key === 'Escape') setGroupOpen(false)
                  }}
                />
                {groupOptions.length > 0 && (
                  <button
                    type="button"
                    className="absolute inset-y-px right-px w-8 flex items-center justify-center text-ghost hover:text-fg transition-colors cursor-pointer outline-none"
                    aria-label={t('newConn.group')}
                    aria-expanded={groupOpen}
                    aria-controls="nc-group-options"
                    onClick={() => setGroupOpen((current) => !current)}
                  >
                    <ChevronDown className={`size-3.5 transition-transform ${groupOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
                {groupOpen && groupOptions.length > 0 && (
                  <div
                    id="nc-group-options"
                    role="listbox"
                    className="absolute z-20 mt-1 w-full max-h-32 overflow-y-auto border border-line-strong rounded-sm bg-raised py-1 shadow-xl"
                  >
                    {groupOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={group === option}
                        className="w-full h-8 px-2.5 flex items-center gap-2 text-left font-sans text-[12px] text-dim hover:bg-white/[0.04] hover:text-fg cursor-pointer outline-none"
                        onClick={() => {
                          setGroup(option)
                          setGroupOpen(false)
                        }}
                      >
                        <span className="flex-1 truncate">{option}</span>
                        {group === option && <Check className="size-3 text-fg shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="nc-description">{t('newConn.description')}</Label>
              <textarea
                id="nc-description"
                rows={2}
                placeholder={t('newConn.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[58px] max-h-28 resize-y bg-surface border border-line rounded-sm px-2.5 py-[7px] font-sans text-[12.5px] leading-5 text-fg outline-none transition-colors duration-100 placeholder:text-[#2e2e2e] focus:border-white/20"
              />
            </div>

            <div>
              <Label>{t('newConn.authMethod')}</Label>
              <ToggleGroup
                type="single"
                value={authType}
                aria-label={t('newConn.authMethod')}
                onValueChange={(value) => {
                  if (value) setAuthType(value as 'password' | 'key')
                }}
              >
                <ToggleGroupItem value="key">{t('newConn.key')}</ToggleGroupItem>
                <ToggleGroupItem value="password">{t('newConn.password')}</ToggleGroupItem>
              </ToggleGroup>
            </div>

            {authType === 'password' ? (
              <>
                <div>
                  <Label htmlFor="nc-password-source">{t('newConn.passwordSource')}</Label>
                  <ConnectionSelect
                    id="nc-password-source"
                    value={pwSource}
                    options={[
                      { value: 'direct', label: t('newConn.passwordDirect') },
                      { value: 'store', label: t('newConn.passwordFromStore') }
                    ]}
                    onValueChange={(value) => setPwSource(value as 'direct' | 'store')}
                  />
                </div>
                {pwSource === 'direct' ? (
                  <div>
                    <Label htmlFor="nc-password">{t('newConn.passwordLabel')}</Label>
                    <Input
                      id="nc-password"
                      type="password"
                      placeholder={t('newConn.passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <Label>{t('newConn.passwordLabel')}</Label>
                    {storePasswords.length === 0 ? (
                      <div className="px-2.5 py-2 font-mono text-[11px] text-ghost">
                        {t('newConn.passwordEmpty')}
                      </div>
                    ) : (
                      <ConnectionSelect
                        value={passwordId}
                        placeholder="—"
                        options={storePasswords.map((passwordEntry) => ({
                          value: passwordEntry.id,
                          label: passwordEntry.label
                        }))}
                        onValueChange={setPasswordId}
                      />
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="nc-key-source">{t('newConn.keySource')}</Label>
                  <ConnectionSelect
                    id="nc-key-source"
                    value={keySource}
                    options={[
                      { value: 'file', label: t('newConn.keyFromFile') },
                      { value: 'store', label: t('newConn.keyFromStore') }
                    ]}
                    onValueChange={(value) => setKeySource(value as 'file' | 'store')}
                  />
                </div>
                {keySource === 'file' ? (
                  <div>
                    <Label>{t('newConn.privateKey')}</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        placeholder={t('newConn.privateKeyPlaceholder')}
                        value={privateKeyPath}
                        className="flex-1 truncate"
                      />
                      <Button type="button" size="sm" className="shrink-0" onClick={browseKey}>
                        {t('common.browse')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label>{t('newConn.privateKey')}</Label>
                    {storeKeys.length === 0 ? (
                      <div className="px-2.5 py-2 font-mono text-[11px] text-ghost">
                        {t('newConn.keyEmpty')}
                      </div>
                    ) : (
                      <ConnectionSelect
                        value={keyId}
                        placeholder="—"
                        options={storeKeys.map((keyEntry) => ({
                          value: keyEntry.id,
                          label: `${keyEntry.name}（${keyEntry.fingerprint}）`
                        }))}
                        onValueChange={setKeyId}
                      />
                    )}
                  </div>
                )}
                <div>
                  <Label htmlFor="nc-passphrase">{t('newConn.passphrase')}</Label>
                  <Input
                    id="nc-passphrase"
                    type="password"
                    placeholder={t('newConn.passphrasePlaceholder')}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter className="connection-dialog-actions">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="solid" disabled={!valid} onClick={handleSubmit}>
              {isEdit ? t('common.save') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SSH Config 主机列表（单选导入，预填充表单） */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('import.title')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="max-h-[340px] overflow-y-auto -mx-1 px-1">
              {configEntries === null ? null : configEntries.length === 0 ? (
                <div className="py-8 text-center font-mono text-[11px] text-ghost">
                  {t('import.empty')}
                </div>
              ) : (
                configEntries.map((e) => (
                  <button
                    key={e.alias}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-sm hover:bg-white/[0.03] cursor-pointer outline-none text-left"
                    onClick={() => applyEntry(e)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[12px] text-fg truncate">{e.alias}</div>
                      <div className="font-mono text-[10px] text-ghost truncate">
                        {e.user ? `${e.user}@` : ''}
                        {e.hostname ?? e.alias}
                        {e.port ? `:${e.port}` : ''}
                      </div>
                    </div>
                    {isDuplicate(e) && (
                      <span className="shrink-0 font-mono text-[10px] text-warn">{t('import.duplicate')}</span>
                    )}
                    {e.hasProxy && (
                      <span className="shrink-0 font-mono text-[10px] text-warn" title={t('import.proxyTitle')}>
                        ⚠ Proxy
                      </span>
                    )}
                    <FolderOpen className="size-3 text-ghost shrink-0" />
                  </button>
                ))
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
