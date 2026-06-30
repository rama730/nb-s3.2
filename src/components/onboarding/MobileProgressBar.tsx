import { cn } from '@/lib/utils'

interface MobileProgressBarProps {
  currentStep: number
  totalSteps: number
  stepLabels: string[]
  completedThrough: number
  justCompletedStep?: number | null
}

export function MobileProgressBar({
  currentStep,
  totalSteps,
  stepLabels,
  completedThrough,
  justCompletedStep = null,
}: MobileProgressBarProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-50 flex h-12 items-center justify-between px-4',
        'bg-muted dark:bg-card border-b border-border',
        'md:hidden'
      )}
      role="progressbar"
      aria-label="Onboarding progress"
      aria-valuemin={0}
      aria-valuemax={totalSteps}
      aria-valuenow={completedThrough}
    >
      {/* Current step label */}
      <span className="text-[13px] font-medium text-foreground">
        {stepLabels[currentStep - 1] ?? ''}
      </span>

      {/* Horizontal dots connected by lines */}
      <div className="flex items-center gap-0">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1
          const isCompleted = step <= completedThrough && step !== currentStep
          const isCurrent = step === currentStep
          const showAcknowledgedCheck = isCurrent && justCompletedStep === step
          const isPending = !isCompleted && !isCurrent

          return (
            <div key={step} className="flex items-center">
              {/* Connecting line before dot (skip for first) */}
              {i > 0 && (
                <div
                  className={cn(
                    'h-[2px] w-4',
                    completedThrough >= step - 1 ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}

              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                {(isCompleted || showAcknowledgedCheck) && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
                {isCurrent && !showAcknowledgedCheck && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
                    <span className="text-[10px] font-semibold text-primary tabular-nums">{step}</span>
                  </div>
                )}
                {isPending && (
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <span className="text-[13px] font-medium text-muted-foreground tabular-nums">
        Step {currentStep} of {totalSteps}
      </span>
    </div>
  )
}
