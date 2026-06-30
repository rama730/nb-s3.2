"use client"

import { cn } from '@/lib/utils'

interface OnboardingLayoutProps {
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
  children,
  sidebar,
  mobileProgress,
}: OnboardingLayoutProps) {
  return (
    <div className={cn('min-h-dvh bg-background md:grid md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]')}>
      <aside
        className={cn(
          'hidden md:block bg-muted dark:bg-card border-r border-border',
          'h-dvh sticky top-0 overflow-y-auto'
        )}
      >
        {sidebar}
      </aside>

      <section className="min-w-0 dark:bg-card">
        <div className="md:hidden">{mobileProgress}</div>
        <main
          className={cn(
            'mx-auto flex min-h-[calc(100dvh-3rem)] w-full flex-col px-4 pb-8 pt-10',
            'md:min-h-dvh md:max-w-[528px] md:px-6 md:pb-10 md:pt-12',
            'lg:max-w-[608px]'
          )}
        >
          {children}
        </main>
      </section>
    </div>
  )
}
