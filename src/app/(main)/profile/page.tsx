
import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { getProfileDetails } from '@/lib/data/profile'
import ProfileShell from '@/components/profile/ProfileShell'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function ProfilePage({ searchParams }: PageProps) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // Check if user has completed onboarding (username in metadata)
    const hasCompletedOnboarding = user.user_metadata?.username || user.user_metadata?.onboarded

    if (!hasCompletedOnboarding) {
        // User hasn't completed onboarding, send them there
        redirect('/onboarding')
    }

    let data;
    try {
        // OPTIMIZATION: usage of "Instant Shell" pattern.
        data = await getProfileDetails(undefined, { skipHeavyData: true })
    } catch (error) {
        console.error('Profile fetch error:', error)
        // If profile query fails (schema mismatch or missing profile), redirect to onboarding
        redirect('/onboarding')
    }

    if (!data) {
        // No profile data - user needs to complete onboarding
        redirect('/onboarding')
    }

    return (
        <div className="h-[calc(100vh-var(--header-height,56px))] min-h-0 overflow-hidden bg-white dark:bg-zinc-950">
            <ProfileShell initialData={data} profileId={data.profile.id} />
        </div>
    )
}
