import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * 按钮：shadcn 结构，视觉对齐原型（2px 圆角、细描边、JetBrains Mono）。
 * ghost-dark 对应原型 .btn-ghost-dark，solid-dark 对应 .btn-solid-dark。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-mono text-xs rounded-sm border outline-none cursor-pointer transition-[border-color,color,background] duration-100 disabled:opacity-40 disabled:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost:
          'border-line bg-transparent text-faint hover:border-white/15 hover:text-fg',
        solid: 'border-white/25 bg-white/[0.06] text-fg hover:bg-white/10',
        icon: 'border-transparent bg-transparent text-[#444] hover:text-fg hover:bg-white/5'
      },
      size: {
        sm: 'px-2 py-1 text-[11px]',
        md: 'px-3.5 py-2',
        icon: 'p-1'
      }
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
