'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'

interface OnboardingGuardProps {
    children: React.ReactNode
}

export function OnboardingGuard({ children }: OnboardingGuardProps) {
    const router = useRouter()
    const { user, profile, isLoading } = useAuth()

    useEffect(() => {
        if (isLoading) return

        if (!user) {
            router.push('/login')
            return
        }

        // Check if user has completed onboarding (has username)
        // profile comes from AuthProvider which already mapped it
        if (!profile?.username) {
            router.push('/onboarding')
        }
    }, [user, profile, isLoading, router])

    if (isLoading) {
        // Since we hydrate from server, this is rarely hit for long, 
        // but prevents flashes for client-side transitions
        return null 
    }

    if (!user || !profile?.username) {
        return null
    }

    return <>{children}</>
}
