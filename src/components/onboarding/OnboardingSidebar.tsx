"use client"

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

import { motion } from 'framer-motion'

interface OnboardingSidebarProps {
  currentStep: number
  totalSteps: number
  stepLabels: Array<{ title: string; subtitle: string }>
  completedSteps: Set<number>
  justCompletedStep?: number | null
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
  justCompletedStep = null,
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
        <ol className="relative flex flex-col">
          {Array.from({ length: totalSteps }, (_, i) => {
            const step = i + 1
            const isCurrent = step === currentStep
            const showAcknowledgedCheck = isCurrent && justCompletedStep === step
            const isCompleted = step < currentStep
            const isPending = !isCompleted && !isCurrent

            return (
              <li
                key={step}
                className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-8 last:pb-0 items-start"
                {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
              >
                {/* Connecting line (not on last step) */}
                {step < totalSteps && (
                  <>
                    {/* Gray background line segment */}
                    <div
                      className="absolute left-[11px] top-[12px] bottom-[-12px] w-[2px] bg-border rounded-full z-0"
                      aria-hidden="true"
                    />
                    {/* Blue animated progress line segment */}
                    <motion.div
                      className="absolute left-[11px] top-[12px] w-[2px] bg-primary rounded-full origin-top z-0"
                      style={{ bottom: '-12px' }}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: isCompleted ? 1 : 0 }}
                      transition={{ type: 'spring', stiffness: 90, damping: 18 }}
                      aria-hidden="true"
                    />
                  </>
                )}
                {/* Step indicator circle */}
                <div className="relative z-10 flex shrink-0 items-center justify-center">
                  {(isCompleted || showAcknowledgedCheck) && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary animate-stepper-fill shadow-sm relative overflow-hidden">
                      <Check className="h-3 w-3 text-white animate-stepper-check" strokeWidth={3} />
                      <span className="sr-only">Step {step} completed</span>
                    </div>
                  )}
                  {isCurrent && !showAcknowledgedCheck && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-muted dark:bg-card text-primary shadow-sm relative overflow-hidden">
                      <div className="absolute inset-0 bg-primary/10" />
                      <span className="relative z-10 text-[11px] font-semibold tabular-nums">{step}</span>
                    </div>
                  )}
                  {isPending && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-muted dark:bg-card text-muted-foreground shadow-sm relative overflow-hidden">
                      <div className="absolute inset-0 bg-muted-foreground/10" />
                      <span className="relative z-10 text-[11px] font-medium">
                        {step}
                      </span>
                    </div>
                  )}
                </div>

                {/* Step labels */}
                <div className="min-w-0 pt-0.5">
                  <p
                    className={cn(
                      'text-[14px] font-medium leading-5',
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
          href="mailto:support@networkbase.in?subject=Onboarding%20help"
          className="text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none   "
        >
          Need help?
        </a>
      </div>
    </div>
  )
}
