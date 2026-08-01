import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  Copy,
  FileKey,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react'
import type { KeyEntry, PasswordMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * 凭证管理弹窗：密钥（ssh-keygen 真实生成 / 导入 / 删除 / 复制公钥）+
 * 密码库（safeStorage 加密落盘）。删除被主机引用的凭证时主进程拒绝并返回引用主机名。
 */
interface CredentialsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBack: () => void
}

const fmtDate = (ts: number): string =>
  new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })

export function CredentialsDialog({ open, onOpenChange, onBack }: CredentialsDialogProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'keys' | 'passwords'>('keys')
  const [keys, setKeys] = useState<KeyEntry[]>([])
  const [passwords, setPasswords] = useState<PasswordMeta[]>([])
  const [keyName, setKeyName] = useState('')
  const [pwLabel, setPwLabel] = useState('')
  const [pwValue, setPwValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editingKeyName, setEditingKeyName] = useState('')
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null)
  const [editingPasswordLabel, setEditingPasswordLabel] = useState('')
  const [editingPasswordValue, setEditingPasswordValue] = useState('')

  const reload = useCallback(async () => {
    const [k, p] = await Promise.all([window.api.creds.listKeys(), window.api.creds.listPasswords()])
    setKeys(k)
    setPasswords(p)
  }, [])

  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  const handleGenerate = async () => {
    const name = keyName.trim()
    if (!name || busy) return
    setBusy(true)
    const result = await window.api.creds.generateKey(name)
    setBusy(false)
    if ('error' in result) {
      toast.error(t('creds.generateFailed', { message: result.error }))
      return
    }
    setKeyName('')
    reload()
  }

  const handleImport = async () => {
    if (busy) return
    const path = await window.api.dialog.pickFile()
    if (!path) return
    const name = keyName.trim() || (path.split(/[\\/]/).pop() ?? t('creds.importedDefault'))
    setBusy(true)
    const result = await window.api.creds.importKey(name, path)
    setBusy(false)
    if ('error' in result) {
      toast.error(t('creds.importFailed', { message: result.error }))
      return
    }
    setKeyName('')
    reload()
  }

  const handleDeleteKey = async (entry: KeyEntry) => {
    const err = await window.api.creds.deleteKey(entry.id)
    if (err) {
      toast.error(t('creds.deleteFailed', { message: err }))
      return
    }
    reload()
  }

  const handleReplaceKey = async (entry: KeyEntry) => {
    if (busy) return
    const path = await window.api.dialog.pickFile()
    if (!path) return
    setBusy(true)
    const result = await window.api.creds.replaceKey(entry.id, path)
    setBusy(false)
    if ('error' in result) {
      toast.error(t('creds.replaceFailed', { message: result.error }))
      return
    }
    toast.success(t('creds.replaced'))
    reload()
  }

  const beginRenameKey = (entry: KeyEntry) => {
    if (busy) return
    setEditingKeyId(entry.id)
    setEditingKeyName(entry.name)
  }

  const submitRenameKey = async (entry: KeyEntry) => {
    const name = editingKeyName.trim()
    if (!name || busy) return
    if (name === entry.name) {
      setEditingKeyId(null)
      return
    }
    setBusy(true)
    const err = await window.api.creds.renameKey(entry.id, name)
    setBusy(false)
    if (err) {
      toast.error(t('creds.renameFailed', { message: err }))
      return
    }
    setEditingKeyId(null)
    reload()
  }

  const handleAddPassword = async () => {
    const label = pwLabel.trim()
    if (!label || !pwValue || busy) return
    setBusy(true)
    await window.api.creds.addPassword(label, pwValue)
    setBusy(false)
    setPwLabel('')
    setPwValue('')
    reload()
  }

  const handleDeletePassword = async (entry: PasswordMeta) => {
    const err = await window.api.creds.deletePassword(entry.id)
    if (err) {
      toast.error(t('creds.deleteFailed', { message: err }))
      return
    }
    reload()
  }

  const beginEditPassword = (entry: PasswordMeta) => {
    if (busy) return
    setEditingPasswordId(entry.id)
    setEditingPasswordLabel(entry.label)
    setEditingPasswordValue('')
  }

  const submitPasswordEdit = async (entry: PasswordMeta) => {
    const label = editingPasswordLabel.trim()
    if (!label || busy) return
    if (label === entry.label && !editingPasswordValue) {
      setEditingPasswordId(null)
      return
    }
    setBusy(true)
    const err = await window.api.creds.updatePassword(entry.id, label, editingPasswordValue)
    setBusy(false)
    if (err) {
      toast.error(t('creds.updatePasswordFailed', { message: err }))
      return
    }
    setEditingPasswordId(null)
    setEditingPasswordValue('')
    reload()
  }

  const copyPub = (entry: KeyEntry) => {
    navigator.clipboard.writeText(entry.publicKey)
    toast.success(t('creds.copied'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[520px]">
        <DialogHeader className="flex flex-row items-center gap-2.5 pr-12">
          <button
            className="icon-btn -ml-1"
            title={t('creds.backToConnections')}
            aria-label={t('creds.backToConnections')}
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <DialogTitle>{t('creds.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'keys' | 'passwords')}>
            <TabsList>
              <TabsTrigger value="keys">{t('creds.tabKeys')}</TabsTrigger>
              <TabsTrigger value="passwords">{t('creds.tabPasswords')}</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'keys' ? (
            <>
              {/* 生成 / 导入行 */}
              <div className="flex gap-2">
                <Input
                  placeholder={t('creds.namePlaceholder')}
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" size="sm" variant="solid" disabled={!keyName.trim() || busy} onClick={handleGenerate}>
                  <Plus className="size-3.5 mr-1" />
                  {t('creds.generate')}
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={handleImport}>
                  <FileKey className="size-3.5 mr-1" />
                  {t('creds.import')}
                </Button>
              </div>

              <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
                {keys.length === 0 ? (
                  <div className="py-8 text-center font-mono text-[11px] text-ghost">
                    {t('creds.emptyKeys')}
                  </div>
                ) : (
                  keys.map((k) => (
                    <div key={k.id} className="flex items-center gap-2.5 px-2 py-2 rounded-sm hover:bg-white/[0.03] cred-key-row">
                      <KeyRound className="size-3.5 text-dim shrink-0" />
                      <div className="flex-1 min-w-0">
                        {editingKeyId === k.id ? (
                          <input
                            autoFocus
                            className="w-full bg-elevated border border-line-strong rounded-sm px-1.5 py-0.5 font-mono text-[12px] text-fg outline-none"
                            value={editingKeyName}
                            aria-label={t('creds.keyName')}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setEditingKeyName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitRenameKey(k)
                              if (e.key === 'Escape') setEditingKeyId(null)
                            }}
                            onBlur={() => setEditingKeyId(null)}
                          />
                        ) : (
                          <div
                            className="font-mono text-[12px] text-fg truncate cursor-text select-text"
                            title={t('creds.editKeyHint')}
                            onDoubleClick={() => beginRenameKey(k)}
                          >
                            {k.name}
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-ghost truncate">
                          {k.fingerprint} · {fmtDate(k.createdAt)}
                        </div>
                      </div>
                      <button className="icon-btn" title={t('creds.editKey')} onClick={() => beginRenameKey(k)}>
                        <Pencil className="size-3.5" />
                      </button>
                      <button className="icon-btn" title={t('creds.replaceKey')} onClick={() => handleReplaceKey(k)}>
                        <RefreshCw className="size-3.5" />
                      </button>
                      <button className="icon-btn" title={t('creds.copyPub')} onClick={() => copyPub(k)}>
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        className="icon-btn hover:!text-danger"
                        title={t('creds.deleteKey')}
                        onClick={() => handleDeleteKey(k)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* 添加密码行 */}
              <div className="flex gap-2">
                <Input
                  placeholder={t('creds.passwordLabelPlaceholder')}
                  value={pwLabel}
                  onChange={(e) => setPwLabel(e.target.value)}
                  className="w-[180px] shrink-0"
                />
                <Input
                  type="password"
                  placeholder={t('creds.passwordValuePlaceholder')}
                  value={pwValue}
                  onChange={(e) => setPwValue(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="solid"
                  disabled={!pwLabel.trim() || !pwValue || busy}
                  onClick={handleAddPassword}
                >
                  <Plus className="size-3.5 mr-1" />
                  {t('creds.addPassword')}
                </Button>
              </div>

              <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
                {passwords.length === 0 ? (
                  <div className="py-8 text-center font-mono text-[11px] text-ghost">
                    {t('creds.emptyPasswords')}
                  </div>
                ) : (
                  passwords.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 px-2 py-2 rounded-sm hover:bg-white/[0.03] cred-pw-row">
                      <KeyRound className="size-3.5 text-dim shrink-0" />
                      {editingPasswordId === p.id ? (
                        <div
                          className="flex-1 min-w-0 flex items-center gap-1.5"
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditingPasswordId(null)
                          }}
                        >
                          <input
                            autoFocus
                            className="min-w-0 w-[150px] bg-elevated border border-line-strong rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none"
                            value={editingPasswordLabel}
                            aria-label={t('creds.passwordLabel')}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setEditingPasswordLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitPasswordEdit(p)
                              if (e.key === 'Escape') setEditingPasswordId(null)
                            }}
                          />
                          <input
                            className="flex-1 min-w-0 bg-elevated border border-line-strong rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none"
                            type="password"
                            value={editingPasswordValue}
                            aria-label={t('creds.passwordValue')}
                            placeholder={t('creds.passwordUnchangedPlaceholder')}
                            autoComplete="new-password"
                            onChange={(e) => setEditingPasswordValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitPasswordEdit(p)
                              if (e.key === 'Escape') setEditingPasswordId(null)
                            }}
                          />
                          <button className="icon-btn" title={t('creds.savePasswordChanges')} onClick={() => submitPasswordEdit(p)}>
                            <Check className="size-3.5" />
                          </button>
                          <button className="icon-btn" title={t('creds.cancelEdit')} onClick={() => setEditingPasswordId(null)}>
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <div
                              className="font-mono text-[12px] text-fg truncate cursor-text select-text"
                              title={t('creds.editPasswordHint')}
                              onDoubleClick={() => beginEditPassword(p)}
                            >
                              {p.label}
                            </div>
                            <div className="font-mono text-[10px] text-ghost">{fmtDate(p.createdAt)}</div>
                          </div>
                          <button className="icon-btn" title={t('creds.editPassword')} onClick={() => beginEditPassword(p)}>
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            className="icon-btn hover:!text-danger"
                            title={t('creds.deletePassword')}
                            onClick={() => handleDeletePassword(p)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
