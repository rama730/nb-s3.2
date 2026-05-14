import { cn } from '@/lib/utils'

interface MobileProgressBarProps {
  currentStep: number
  totalSteps: number
  stepLabels: string[]
}

export function MobileProgressBar({
  currentStep,
  totalSteps,
  stepLabels,
}: MobileProgressBarProps) {
  const completionPercentage = Math.round(((currentStep - 1) / totalSteps) * 100)

  return (
    <div
      className={cn(
        'sticky top-0 z-50 flex h-12 items-center justify-between px-4',
        'bg-muted dark:bg-card border-b border-border',
        'md:hidden'
      )}
    >
      {/* Current step label */}
      <span className="text-[13px] font-medium text-foreground">
        {stepLabels[currentStep - 1] ?? ''}
      </span>

      {/* Horizontal dots connected by lines */}
      <div className="flex items-center gap-0">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1
          const isCompleted = step < currentStep
          const isCurrent = step === currentStep
          const isPending = step > currentStep

          return (
            <div key={step} className="flex items-center">
              {/* Connecting line before dot (skip for first) */}
              {i > 0 && (
                <div
                  className={cn(
                    'h-[2px] w-4',
                    isCompleted || isCurrent ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}

              {/* Dot */}
              {isCompleted && (
                <div className="h-2 w-2 rounded-full bg-primary" />
              )}
              {isCurrent && (
                <div className="flex h-2 w-2 items-center justify-center rounded-full ring-2 ring-primary/20">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                </div>
              )}
              {isPending && (
                <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              )}
            </div>
          )
        })}
      </div>

      {/* Completion percentage */}
      <span className="text-[13px] font-medium text-muted-foreground">
        {completionPercentage}%
      </span>
    </div>
  )
}
