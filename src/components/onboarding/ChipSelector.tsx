'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChipOption {
  value: string
  label: string
}

interface ChipSelectorProps {
  options: ChipOption[]
  selected: Set<string>
  onToggle: (value: string) => void
  variant: 'single' | 'multi'
  size?: 'sm' | 'md'
  colorVariant?: 'primary' | 'secondary'
  maxVisible?: number
  expandLabel?: string
}

export default function ChipSelector({
  options,
  selected,
  onToggle,
  variant,
  size = 'md',
  colorVariant = 'primary',
  maxVisible = 12,
  expandLabel = 'Show more',
}: ChipSelectorProps) {
  const [expanded, setExpanded] = useState(false)

  const shouldCollapse = options.length > maxVisible
  const visibleOptions = shouldCollapse && !expanded
    ? options.slice(0, maxVisible)
    : options

  const hiddenCount = options.length - maxVisible

  const handleToggle = (value: string) => {
    if (variant === 'single') {
      // In single mode, toggling the already-selected value deselects it
      onToggle(value)
    } else {
      onToggle(value)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" className="flex flex-wrap gap-2">
        {visibleOptions.map((option) => {
          const isSelected = selected.has(option.value)

          return (
            <button
              key={option.value}
              type="button"
              role="button"
              aria-pressed={isSelected}
              onClick={() => handleToggle(option.value)}
              className={cn(
                'inline-flex items-center rounded-full transition-[background-color,border-color] duration-150 ease-in-out',
                'text-[13px] font-[450] leading-none select-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'min-h-[44px] sm:min-h-0',
                // Size variants
                size === 'sm' && 'px-[14px] py-[6px]',
                size === 'md' && 'px-4 py-2',
                // Unselected state
                !isSelected && [
                  'bg-background border border-border text-foreground',
                  'hover:bg-muted hover:border-border/80',
                ],
                // Selected state - primary
                isSelected && colorVariant === 'primary' && [
                  'bg-primary/8 border-[1.5px] border-primary text-primary',
                ],
                // Selected state - secondary (chart-2)
                isSelected && colorVariant === 'secondary' && [
                  'bg-chart-2/8 border-[1.5px] border-chart-2 text-chart-2',
                ],
              )}
            >
              {isSelected && (
                <Check
                  className={cn(
                    'w-3 h-3 mr-1.5 shrink-0',
                    colorVariant === 'primary' && 'text-primary',
                    colorVariant === 'secondary' && 'text-chart-2',
                  )}
                  strokeWidth={2.5}
                />
              )}
              {option.label}
            </button>
          )
        })}
      </div>

      {/* Show more / Show less toggle */}
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-150 self-start min-h-[44px] sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              {expandLabel} ({hiddenCount} more)
            </>
          )}
        </button>
      )}

      {/* Selection counter */}
      {selected.size > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {selected.size} selected
        </p>
      )}
    </div>
  )
}
