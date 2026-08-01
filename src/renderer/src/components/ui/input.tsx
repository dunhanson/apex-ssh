import * as React from 'react'
import { cn } from '@/lib/utils'

/** 输入框：对应原型 .field-input（#060606 底、细描边、聚焦描边加亮） */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'w-full bg-surface border border-line rounded-sm px-2.5 py-[7px] text-[12.5px] text-fg',
        'outline-none transition-colors duration-100 placeholder:text-[#2e2e2e]',
        'focus:border-white/20',
        className
      )}
      {...props}
    />
  )
}

export { Input }
