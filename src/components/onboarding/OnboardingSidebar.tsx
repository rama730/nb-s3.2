"use client"

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnboardingSidebarProps {
  currentStep: number
  totalSteps: number
  stepLabels: Array<{ title: string; subtitle: string }>
  completedSteps: Set<number>
}

/**
 * OnboardingSidebar — Persistent left rail showing brand, vertical stepper progress, and help link.
 *
 * Width: 280px on desktop (≥1024px), 220px on tablet (768–1023px).
 * Background: `muted` with a right `border`.
 * Top: brand logo/mark (24px height) + app name.
 * Middle: VerticalStepper with numbered circles.
 * Bottom: "Need help?" link.
 *
 * Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 16.5
 */
export function OnboardingSidebar({
  currentStep,
  totalSteps,
  stepLabels,
  completedSteps,
}: OnboardingSidebarProps) {
  return (
    <div className="flex h-full flex-col px-6 py-8">
      {/* Top: Brand logo/mark + app name */}
      <div className="mb-10 flex items-center gap-2">
        <div className="relative h-6 w-6">
          <div className="absolute inset-0 app-accent-gradient rounded-md" />
          <div className="relative flex h-full w-full items-center justify-center">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
            </svg>
          </div>
        </div>
        <span className="text-base font-semibold text-foreground">NB</span>
      </div>

      {/* Middle: Vertical Stepper */}
      <nav aria-label="Onboarding progress" className="flex-1">
        <ol className="relative flex flex-col gap-0">
          {Array.from({ length: totalSteps }, (_, i) => {
            const step = i + 1
            const isCompleted = completedSteps.has(step)
            const isCurrent = step === currentStep
            const isPending = !isCompleted && !isCurrent

            return (
              <li
                key={step}
                className="relative flex gap-3"
                {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
              >
                {/* Connecting line (not on last step) */}
                {step < totalSteps && (
                  <div
                    className={cn(
                      'absolute left-[11px] top-[24px] w-[2px] h-[calc(100%-24px)]',
                      isCompleted
                        ? 'bg-primary animate-stepper-line-fill'
                        : 'bg-border'
                    )}
                    aria-hidden="true"
                  />
                )}

                {/* Step indicator circle */}
                <div className="relative z-10 flex shrink-0 items-center justify-center">
                  {isCompleted && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary animate-stepper-fill">
                      <Check className="h-3 w-3 text-white animate-stepper-check" strokeWidth={3} />
                    </div>
                  )}
                  {isCurrent && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-primary/20 animate-pulse-step">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                  )}
                  {isPending && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/20">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {step}
                      </span>
                    </div>
                  )}
                </div>

                {/* Step labels */}
                <div className={cn('pb-8', step === totalSteps && 'pb-0')}>
                  <p
                    className={cn(
                      'text-[14px] font-medium leading-6',
                      isCurrent ? 'text-foreground' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {stepLabels[i]?.title}
                  </p>
                  <p className="text-[12px] text-muted-foreground leading-tight mt-0.5">
                    {stepLabels[i]?.subtitle}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Bottom: Help link */}
      <div className="mt-auto pt-6">
        <a
          href="#help"
          className="text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Need help?
        </a>
      </div>
    </div>
  )
}
