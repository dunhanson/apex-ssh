import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface NumberInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> {
  value: string | number
  onValueChange: (value: string) => void
  incrementLabel: string
  decrementLabel: string
}

function NumberInput({
  className,
  value,
  min,
  max,
  disabled,
  readOnly,
  onValueChange,
  incrementLabel,
  decrementLabel,
  ...props
}: NumberInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const numericValue = value === '' ? null : Number(value)
  const canDecrease =
    !disabled &&
    !readOnly &&
    (numericValue === null || !Number.isFinite(numericValue) || min == null || numericValue > Number(min))
  const canIncrease =
    !disabled &&
    !readOnly &&
    (numericValue === null || !Number.isFinite(numericValue) || max == null || numericValue < Number(max))

  const stepValue = (direction: 'up' | 'down') => {
    const input = inputRef.current
    if (!input) return
    if (direction === 'up') input.stepUp()
    else input.stepDown()
    onValueChange(input.value)
    input.focus()
  }

  return (
    <div
      data-slot="number-input"
      className={cn(
        'flex h-9 w-full overflow-hidden rounded-sm border border-line bg-surface transition-colors duration-100 focus-within:border-white/20',
        disabled && 'opacity-40',
        className
      )}
    >
      <Input
        {...props}
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent pr-2 font-mono [appearance:textfield] focus:border-transparent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      <div className="grid w-7 shrink-0 grid-rows-2 border-l border-line">
        <Button
          type="button"
          variant="icon"
          size="icon"
          className="h-auto w-full rounded-none border-0 p-0"
          disabled={!canIncrease}
          aria-label={incrementLabel}
          title={incrementLabel}
          onClick={() => stepValue('up')}
        >
          <ChevronUp data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="icon"
          size="icon"
          className="h-auto w-full rounded-none border-x-0 border-b-0 border-t border-line p-0"
          disabled={!canDecrease}
          aria-label={decrementLabel}
          title={decrementLabel}
          onClick={() => stepValue('down')}
        >
          <ChevronDown data-icon="inline-start" />
        </Button>
      </div>
    </div>
  )
}

export { NumberInput }
