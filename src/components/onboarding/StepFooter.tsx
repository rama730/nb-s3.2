"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface StepFooterProps {
  step: number
  totalSteps: number
  canProceed: boolean
  isLoading: boolean
  loadingLabel?: string
  nextLabel?: string
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
}

export function StepFooter({
  step,
  totalSteps,
  canProceed,
  isLoading,
  loadingLabel = "Saving...",
  nextLabel = "Continue",
  onBack,
  onNext,
  onSubmit,
}: StepFooterProps) {
  const isFinalStep = step === totalSteps
  const isFirstStep = step === 1

  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-border pt-6",
        // Below 360px: stack buttons vertically at full width
        "max-[359px]:flex-col max-[359px]:gap-3"
      )}
    >
      {/* Back button — hidden on first step but keeps space for layout */}
      {isFirstStep ? (
        <div className="max-[359px]:hidden" />
      ) : (
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isLoading}
          className={cn(
            "text-muted-foreground min-h-[44px]",
            "  ",
            "max-[359px]:w-full max-[359px]:order-2"
          )}
          type="button"
        >
          Back
        </Button>
      )}

      {/* Continue / Complete setup button */}
      <button
        type="button"
        disabled={!canProceed || isLoading}
        onClick={isFinalStep ? onSubmit : onNext}
        className={cn(
          "inline-flex items-center justify-center",
          "h-[var(--ui-control-height)] min-h-[44px] min-w-[120px] px-5",
          "rounded-md text-[14px] font-medium text-white",
          "transition-colors",
          "outline-none   ",
          isFinalStep ? "app-accent-gradient" : "bg-primary hover:bg-primary/95 active:bg-primary/90",
          (!canProceed || isLoading) && "opacity-50 pointer-events-none",
          // Below 360px: full width, ordered first
          "max-[359px]:w-full max-[359px]:order-1"
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {loadingLabel}
          </>
        ) : isFinalStep ? (
          "Complete setup"
        ) : (
          nextLabel
        )}
      </button>
    </div>
  )
}
