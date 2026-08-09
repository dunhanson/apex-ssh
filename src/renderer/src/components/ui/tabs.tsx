import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

/** 页签与分段切换：设置导航使用 settings 变体，其余使用标准 36px 分段控件。 */
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
          : 'grid h-9 grid-flow-col auto-cols-fr gap-[3px] rounded-sm border border-line bg-surface p-[3px]',
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
          ? 'flex h-[34px] shrink-0 items-center justify-start gap-2 rounded-sm px-2.5 font-sans text-xs text-faint outline-none transition-colors duration-100 hover:bg-white/[0.025] hover:text-dim data-[state=active]:bg-accent data-[state=active]:text-fg [&_svg]:size-3.5 [&_svg]:shrink-0'
          : 'flex h-7 min-w-0 cursor-pointer items-center justify-center rounded-xs px-3 font-sans text-xs font-medium text-dim outline-none transition-[background-color,color,box-shadow] duration-100 hover:bg-white/[0.035] hover:text-fg focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
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
