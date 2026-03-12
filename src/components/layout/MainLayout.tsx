'use client'

import { type ReactNode } from 'react'
import TopNav from '@/components/layout/header/TopNav'
import { OnboardingGuard } from '@/components/auth/OnboardingGuard'
import { useAuth } from '@/hooks/useAuth'
import { isHardeningDomainEnabled } from '@/lib/features/hardening'

interface MainLayoutProps {
    children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
    const { user } = useAuth();
    const shellHardeningEnabled = isHardeningDomainEnabled("shellV1", user?.id ?? null);

    return (
        <OnboardingGuard>
            <div
                className="h-dvh min-h-0 overflow-hidden bg-background flex flex-col"
                data-hardening-shell={shellHardeningEnabled ? "v1" : "off"}
            >
                <TopNav />
                <main className="flex-1 min-h-0 overflow-hidden">
                    {children}
                </main>
            </div>
        </OnboardingGuard>
    )
}
