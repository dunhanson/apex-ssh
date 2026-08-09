import { Toaster as SonnerToaster } from 'sonner'

/** toast：对应原型 .toast（顶部居中、#0a0a0a 底、JetBrains Mono、2px 圆角） */
function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      gap={8}
      visibleToasts={1}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex items-center gap-2 bg-raised border border-white/[0.14] text-body rounded-sm px-3.5 py-2 font-mono text-xs shadow-lg',
          success: '[&_[data-icon]]:text-ok',
          error: '[&_[data-icon]]:text-danger',
          info: '[&_[data-icon]]:text-dim'
        }
      }}
    />
  )
}

export { Toaster }
