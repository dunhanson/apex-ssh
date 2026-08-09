import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

function Switch({
  className,
  emphasized = false,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { emphasized?: boolean }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-emphasized={emphasized || undefined}
      className={cn(
        'group inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-elevated outline-none transition-[background-color,border-color,box-shadow]',
        'focus-visible:border-white/25 focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[emphasized=true]:data-[state=checked]:border-settings-emphasis data-[emphasized=true]:data-[state=checked]:bg-settings-emphasis',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 translate-x-0 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
