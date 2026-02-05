'use client'

import { type ReactNode } from 'react'
import TopNav from '@/components/layout/header/TopNav'
import { OnboardingGuard } from '@/components/auth/OnboardingGuard'
import { WorkspaceProvider, WorkspaceDock } from '@/components/workspace-v2'

interface MainLayoutProps {
    children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
    return (
        <OnboardingGuard>
            <WorkspaceProvider>
                <div className="min-h-screen bg-background flex flex-col">
                    <TopNav />
                    <main className="flex-1 min-h-0">
                        {children}
                    </main>
                    <WorkspaceDock />
                </div>
            </WorkspaceProvider>
        </OnboardingGuard>
    )
}
