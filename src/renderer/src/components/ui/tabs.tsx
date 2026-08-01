import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

/** 页签切换（认证方式 Key/Password 等）：细描边分段控件 */
const Tabs = TabsPrimitive.Root

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: 'default' | 'settings'
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        variant === 'settings'
          ? 'settings-navigation flex flex-col items-stretch gap-1 overflow-y-auto border-r border-line bg-panel p-3'
          : 'flex overflow-hidden rounded-sm border border-line',
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  variant?: 'default' | 'settings'
}) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(
        variant === 'settings'
          ? 'flex h-[34px] shrink-0 items-center justify-start gap-2 rounded-sm px-2.5 font-mono text-xs text-faint outline-none transition-colors duration-100 hover:bg-white/[0.025] hover:text-dim data-[state=active]:bg-white/[0.065] data-[state=active]:text-fg [&_svg]:size-3.5 [&_svg]:shrink-0'
          : 'flex-1 cursor-pointer py-1.5 font-mono text-[11px] text-faint outline-none transition-colors duration-100 hover:text-dim data-[state=active]:bg-white/[0.06] data-[state=active]:text-fg',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
