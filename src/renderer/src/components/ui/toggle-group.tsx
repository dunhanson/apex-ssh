import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import { toggleVariants } from '@/components/ui/toggle'

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    data-slot="toggle-group"
    className={cn('grid h-9 w-full grid-flow-col auto-cols-fr gap-[3px] rounded-sm border border-line bg-surface p-[3px]', className)}
    {...props}
  />
))
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    data-slot="toggle-group-item"
    className={cn(toggleVariants(), 'w-full', className)}
    {...props}
  />
))
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
