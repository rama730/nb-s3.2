'use client'

import type { ReactNode } from 'react'

interface OnboardingGuardProps {
    children: ReactNode
}

export function OnboardingGuard({ children }: OnboardingGuardProps) {
    return <>{children}</>
}
