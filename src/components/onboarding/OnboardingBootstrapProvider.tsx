'use client'

import { createContext, useContext } from 'react'
import type { OnboardingStep2SectionId } from '@/lib/onboarding/config'
import type { OnboardingStatus } from '@/lib/onboarding/state'

export type OnboardingBootstrap = {
  userId: string
  status: OnboardingStatus
  draft: {
    step: number
    completedThrough: number
    activeSection: OnboardingStep2SectionId
    version: number
    schemaVersion: number
    data: Record<string, unknown>
    updatedAt: string | null
  }
}

const OnboardingBootstrapContext = createContext<OnboardingBootstrap | null>(null)

export function OnboardingBootstrapProvider({
  value,
  children,
}: {
  value: OnboardingBootstrap
  children: React.ReactNode
}) {
  return (
    <OnboardingBootstrapContext.Provider value={value}>
      {children}
    </OnboardingBootstrapContext.Provider>
  )
}

export function useOnboardingBootstrap(): OnboardingBootstrap {
  const value = useContext(OnboardingBootstrapContext)
  if (!value) {
    throw new Error('useOnboardingBootstrap must be used inside OnboardingBootstrapProvider')
  }
  return value
}
