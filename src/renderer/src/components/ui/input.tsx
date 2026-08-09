import * as React from 'react'
import { cn } from '@/lib/utils'

/** shadcn Input：36px 高、4px 圆角、统一表面与三像素聚焦环。 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-sm border border-line bg-surface px-2.5 font-sans text-[12.5px] text-fg',
        'outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-faint',
        'focus-visible:border-white/25 focus-visible:ring-[3px] focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
