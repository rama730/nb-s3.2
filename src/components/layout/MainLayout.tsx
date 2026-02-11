'use client'

import { type ReactNode } from 'react'
import TopNav from '@/components/layout/header/TopNav'
import { OnboardingGuard } from '@/components/auth/OnboardingGuard'

interface MainLayoutProps {
    children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
    return (
        <OnboardingGuard>
            <div className="min-h-screen bg-background flex flex-col">
                <TopNav />
                <main className="flex-1 min-h-0">
                    {children}
                </main>
            </div>
        </OnboardingGuard>
    )
}
