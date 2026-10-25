import { Toaster as SonnerToaster } from 'sonner'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function Toaster() {
  const { t } = useTranslation()
  return (
    <SonnerToaster
      position="bottom-right"
      offset={16}
      mobileOffset={16}
      gap={8}
      visibleToasts={3}
      duration={4000}
      closeButton
      icons={{
        success: <CircleCheck size={14} />,
        error: <CircleAlert size={14} />,
        warning: <TriangleAlert size={14} />,
        info: <Info size={14} />
      }}
      toastOptions={{
        closeButtonAriaLabel: t('common.close'),
        unstyled: true,
        classNames: {
          toast: 'apex-toast',
          content: 'apex-toast-content',
          closeButton: 'apex-toast-close',
          success: '[&_[data-icon]]:text-ok',
          error: '[&_[data-icon]]:text-danger',
          warning: '[&_[data-icon]]:text-warn',
          info: '[&_[data-icon]]:text-dim'
        }
      }}
    />
  )
}

export { Toaster }
