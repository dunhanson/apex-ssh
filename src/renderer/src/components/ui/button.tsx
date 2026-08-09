import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** shadcn Button：白色主操作、深色次操作、红色危险操作。 */
const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border px-3 font-sans text-sm font-medium tracking-normal outline-none transition-[border-color,color,background-color,box-shadow] duration-100 focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost: 'border-line bg-surface text-body hover:border-white/20 hover:bg-accent hover:text-fg',
        solid: 'border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover',
        danger: 'border-danger/40 bg-surface text-red-400 hover:border-danger/60 hover:bg-red-400/10 hover:text-red-300',
        icon: 'border-line bg-surface p-0 text-dim hover:border-white/20 hover:bg-accent hover:text-fg'
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-9 px-3',
        icon: 'size-9 p-0'
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
      data-variant={variant ?? 'ghost'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
