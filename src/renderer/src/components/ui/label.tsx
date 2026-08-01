import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

/** 字段标签：对应原型 .field-label（10px 大写、宽字距、JetBrains Mono） */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'block font-mono text-[10px] text-[#444] tracking-[0.08em] uppercase mb-[5px] select-none',
        className
      )}
      {...props}
    />
  )
}

export { Label }
