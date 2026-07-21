'use client'

import { cn } from '@/lib/utils'

export interface RadioCardOption {
  value: string
  label: string
  description: string
}

interface RadioCardGroupProps {
  options: RadioCardOption[]
  selected: string
  onChange: (value: string) => void
  columns?: 1 | 2
  labelledBy?: string
}

export default function RadioCardGroup({
  options,
  selected,
  onChange,
  columns = 1,
  labelledBy,
}: RadioCardGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={cn(
        'grid gap-[10px]',
        columns === 2 ? 'grid-cols-2' : 'grid-cols-1'
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === selected

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex items-start gap-3 rounded-[var(--onb-radius-radio-card)] px-4 py-[14px] text-left transition-[border-color,background-color] duration-150',
              'min-h-[44px]',
              'focus-visible:outline-none   ',
              isSelected
                ? 'border-2 border-primary bg-primary/5'
                : 'border border-border bg-card hover:border-primary/40'
            )}
          >
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-medium leading-snug text-foreground">
                {option.label}
              </span>
              <span className="text-[13px] font-normal leading-snug text-muted-foreground">
                {option.description}
              </span>
            </div>

            {/* Selection indicator — filled circle with inner dot */}
            <div
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150',
                isSelected
                  ? 'border-primary bg-primary'
                  : 'border-border bg-card'
              )}
              aria-hidden="true"
            >
              {isSelected && (
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
