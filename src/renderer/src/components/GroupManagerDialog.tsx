import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, ArrowUp, FolderTree, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import type { HostConfig, HostGroup } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface GroupManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBack: () => void
  groups: HostGroup[]
  hosts: HostConfig[]
  initialGroup?: string | null
  initialAction?: 'edit' | 'delete' | null
  onCreate: (name: string) => Promise<boolean>
  onRename: (currentName: string, nextName: string) => Promise<boolean>
  onDelete: (name: string) => Promise<boolean>
  onReorder: (names: string[]) => Promise<boolean>
}

export function GroupManagerDialog({
  open,
  onOpenChange,
  onBack,
  groups,
  hosts,
  initialGroup,
  initialAction,
  onCreate,
  onRename,
  onDelete,
  onReorder
}: GroupManagerDialogProps) {
  const { t } = useTranslation()
  const [newName, setNewName] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const host of hosts) {
      const name = host.group?.trim()
      if (name) result.set(name, (result.get(name) ?? 0) + 1)
    }
    return result
  }, [hosts])
  const ungroupedCount = hosts.filter((host) => !host.group?.trim()).length

  useEffect(() => {
    if (!open) return
    setNewName('')
    setEditingName(initialAction === 'edit' && initialGroup ? initialGroup : null)
    setEditValue(initialAction === 'edit' && initialGroup ? initialGroup : '')
    setPendingDelete(initialAction === 'delete' && initialGroup ? initialGroup : null)
  }, [initialAction, initialGroup, open])

  const create = async () => {
    if (!newName.trim()) return
    if (await onCreate(newName)) setNewName('')
  }

  const beginEdit = (name: string) => {
    setPendingDelete(null)
    setEditingName(name)
    setEditValue(name)
  }

  const saveEdit = async () => {
    if (!editingName || !editValue.trim()) return
    if (await onRename(editingName, editValue)) setEditingName(null)
  }

  const move = async (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= groups.length) return
    const names = groups.map((group) => group.name)
    ;[names[index], names[target]] = [names[target], names[index]]
    await onReorder(names)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="flex flex-row items-center gap-2.5">
          <button
            type="button"
            className="grid size-7 place-items-center rounded-sm text-faint outline-none hover:bg-accent hover:text-fg focus-visible:ring-[3px] focus-visible:ring-ring"
            title={t('groups.back')}
            aria-label={t('groups.back')}
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <FolderTree className="size-4 text-dim" strokeWidth={1.5} />
          <DialogTitle>{t('groups.title')}</DialogTitle>
          <span className="text-[11px] leading-4 text-ghost">{t('groups.count', { count: groups.length })}</span>
        </DialogHeader>

        <DialogBody className="max-h-[min(620px,calc(100vh-96px))] overflow-y-auto">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-group">{t('groups.newLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="new-group"
                value={newName}
                placeholder={t('groups.newPlaceholder')}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create()
                }}
              />
              <Button variant="solid" disabled={!newName.trim()} onClick={() => void create()}>
                <Plus data-icon="inline-start" />
                {t('groups.create')}
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-sm border border-line bg-ink">
            {groups.map((group, index) => (
              <div key={group.name} className="flex min-h-12 items-center gap-2 border-b border-line px-3 last:border-b-0">
                <FolderTree className="size-3.5 shrink-0 text-faint" />
                {editingName === group.name ? (
                  <Input
                    className="h-8"
                    value={editValue}
                    autoFocus
                    onChange={(event) => setEditValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveEdit()
                      if (event.key === 'Escape') setEditingName(null)
                    }}
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-sans text-sm text-body">{group.name}</div>
                    <div className="text-[11px] leading-4 text-ghost">
                      {t('groups.hostCount', { count: counts.get(group.name) ?? 0 })}
                    </div>
                  </div>
                )}

                {editingName === group.name ? (
                  <>
                    <Button variant="icon" size="icon" className="size-8" title={t('common.save')} aria-label={t('common.save')} disabled={!editValue.trim()} onClick={() => void saveEdit()}>
                      <Save />
                    </Button>
                    <Button variant="icon" size="icon" className="size-8" title={t('common.cancel')} aria-label={t('common.cancel')} onClick={() => setEditingName(null)}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="icon" size="icon" className="size-8" title={t('groups.moveUp')} aria-label={t('groups.moveUp')} disabled={index === 0} onClick={() => void move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="icon" size="icon" className="size-8" title={t('groups.moveDown')} aria-label={t('groups.moveDown')} disabled={index === groups.length - 1} onClick={() => void move(index, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="icon" size="icon" className="size-8" title={t('groups.rename')} aria-label={t('groups.rename')} onClick={() => beginEdit(group.name)}>
                      <Pencil />
                    </Button>
                    <Button variant="danger" size="icon" className="size-8 px-0" title={t('groups.delete')} aria-label={t('groups.delete')} onClick={() => setPendingDelete(group.name)}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            ))}
            <div className="flex min-h-12 items-center gap-2 px-3">
              <FolderTree className="size-3.5 shrink-0 text-ghost" />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm text-faint">{t('sidebar.defaultGroup')}</div>
                <div className="text-[11px] leading-4 text-ghost">{t('groups.hostCount', { count: ungroupedCount })}</div>
              </div>
              <span className="text-[11px] leading-4 text-ghost">{t('groups.systemGroup')}</span>
            </div>
          </div>

          {pendingDelete && (
            <div className="flex flex-col gap-3 rounded-sm border border-danger/40 bg-surface p-3">
              <div>
                <div className="text-sm font-medium text-red-400">{t('groups.deleteTitle', { name: pendingDelete })}</div>
                <div className="mt-1 text-xs leading-5 text-faint">{t('groups.deleteHint')}</div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPendingDelete(null)}>{t('common.cancel')}</Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (await onDelete(pendingDelete)) setPendingDelete(null)
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                  {t('groups.confirmDelete')}
                </Button>
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
