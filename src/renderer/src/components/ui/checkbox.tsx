import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      'peer grid size-3.5 shrink-0 appearance-none place-content-center overflow-hidden rounded-sm border border-line-strong bg-transparent p-0 text-fg outline-none transition-colors focus-visible:border-white/30 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-white/25 data-[state=checked]:bg-white/10',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center">
      <Check className="size-2.5" strokeWidth={2} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
