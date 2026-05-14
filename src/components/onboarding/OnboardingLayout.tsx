"use client"

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface OnboardingLayoutProps {
  currentStep: number
  totalSteps: number
  children: React.ReactNode
  sidebar?: React.ReactNode
  mobileProgress?: React.ReactNode
}

/**
 * OnboardingLayout — Split-pane shell for the onboarding flow.
 *
 * Desktop (≥1024px): sidebar 280px fixed left, content max-width 560px centered right.
 * Tablet (768–1023px): sidebar 220px, content max-width 480px.
 * Mobile (<768px): single column with MobileProgressBar at top.
 *
 * Uses flat `background` color (no gradient). Content area has generous
 * vertical padding (48px top, 32px bottom).
 */
export function OnboardingLayout({
  currentStep,
  totalSteps,
  children,
  sidebar,
  mobileProgress,
}: OnboardingLayoutProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches)
    }
    handleChange(mql)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  if (isMobile) {
    return (
      <div className={cn('min-h-screen bg-background flex flex-col')}>
        {/* Mobile progress bar slot */}
        {mobileProgress}

        {/* Content area — single column, centered */}
        <main
          className={cn(
            'flex-1 flex flex-col items-center px-4',
            'pt-[48px] pb-[32px]'
          )}
        >
          <div className="w-full max-w-[560px]">
            {children}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={cn('min-h-screen bg-background flex')}>
      {/* Sidebar — fixed left */}
      <aside
        className={cn(
          'shrink-0 bg-muted dark:bg-card border-r border-border',
          'h-screen sticky top-0 overflow-y-auto',
          // Tablet: 220px, Desktop: 280px
          'w-[220px] lg:w-[280px]'
        )}
      >
        {sidebar}
      </aside>

      {/* Content area — scrollable right */}
      <main
        className={cn(
          'flex-1 flex flex-col items-center overflow-y-auto dark:bg-card',
          'pt-[48px] pb-[32px] px-6'
        )}
      >
        <div
          className={cn(
            'w-full',
            // Tablet: max 480px, Desktop: max 560px
            'max-w-[480px] lg:max-w-[560px]'
          )}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
