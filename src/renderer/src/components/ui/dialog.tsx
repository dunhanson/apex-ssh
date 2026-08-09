import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 标准表单弹窗：420px、6px 圆角及统一标题栏、正文和操作区间距。 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const { t } = useTranslation()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[4px] flex items-center justify-center">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'relative w-[420px] max-w-[calc(100vw-32px)] rounded-md border border-line-strong bg-raised outline-none shadow-[0_18px_48px_rgba(0,0,0,0.55)]',
            className
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-3 top-3 grid size-7 place-items-center rounded-sm text-faint outline-none transition-colors hover:bg-accent hover:text-fg focus-visible:ring-[3px] focus-visible:ring-ring">
            <X className="size-3.5" />
            <span className="sr-only">{t('common.close')}</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-b border-line px-[18px] py-[14px] pr-12', className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-sans text-sm font-semibold leading-5 tracking-normal text-fg', className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-3.5 px-[18px] pb-5 pt-[18px]', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex gap-2.5 border-t border-line px-[18px] pb-4 pt-[14px]', className)} {...props} />
  )
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter }
