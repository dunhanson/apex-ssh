import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog } from 'radix-ui'
import { Button } from '@/components/ui/button'

export function SettingsConfirmation({
  open, onOpenChange, title, description, action, busy, onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  action: string
  busy: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <AlertDialog.Root open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value) }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="settings-confirmation-overlay" />
        <AlertDialog.Content className="settings-confirmation"
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus()
          }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}>
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="settings-confirmation-actions">
            <AlertDialog.Cancel asChild><Button variant="ghost" disabled={busy}>{t('common.cancel')}</Button></AlertDialog.Cancel>
            <Button variant="danger" disabled={busy} onClick={onConfirm}>{action}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
