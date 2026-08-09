import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

const toggleVariants = cva(
  'inline-flex h-7 min-w-0 items-center justify-center rounded-xs px-3 font-sans text-xs font-medium text-dim outline-none transition-[background-color,color,box-shadow] hover:bg-white/[0.035] hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-fg data-[state=on]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
  {
    variants: {
      size: {
        default: 'h-7 px-3',
        compact: 'h-5 px-2 text-[10px]'
      }
    },
    defaultVariants: { size: 'default' }
  }
)

function Toggle({ className, size, ...props }: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root className={cn(toggleVariants({ size }), className)} {...props} />
}

export { Toggle, toggleVariants }
