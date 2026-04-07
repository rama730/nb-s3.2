import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getProfileDetails, getUserProfile } from '@/lib/data/profile'
import ProfileShell from '@/components/profile/ProfileShell'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { logger } from '@/lib/logger'
import { buildOwnerProfileTitle, buildProfileMetadataDescription } from '@/lib/profile/display'

export async function generateMetadata() {
    const { user } = await getViewerAuthContext()
    if (!user) {
        return buildRouteMetadata({
            title: 'Your Profile | Edge',
            description: 'Your personal profile and presence on Edge.',
            path: '/profile',
        })
    }

    let profile: Awaited<ReturnType<typeof getUserProfile>> | null = null
    try {
        profile = await getUserProfile(user.id)
    } catch (error) {
        logger.warn('[profile.page] failed to load profile metadata', {
            module: 'profile',
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
        })
    }

    return buildRouteMetadata({
        title: buildOwnerProfileTitle({
            username: profile?.username,
            fullName: profile?.fullName,
        }),
        description: buildProfileMetadataDescription({
            username: profile?.username,
            fullName: profile?.fullName,
            headline: profile?.headline,
            location: profile?.location,
            bio: profile?.bio,
        }),
        path: '/profile',
        image: profile?.avatarUrl || undefined,
    })
}

export default async function ProfilePage() {
    const { user } = await getViewerAuthContext()

    if (!user) {
        redirect('/login')
    }

    let content: ReactNode = null
    const fallbackContent = (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
            <div className="max-w-md rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Unable to load your profile</h1>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    We couldn&apos;t load your profile data. Please refresh the page or try again later, and contact support if the problem persists.
                </p>
            </div>
        </div>
    )
    let profileData: Awaited<ReturnType<typeof getProfileDetails>> | null = null
    try {
        profileData = await getProfileDetails(undefined, {
            viewerUser: user,
        })
    } catch (error) {
        logger.error('[profile.page] failed to load profile shell', {
            module: 'profile',
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        })
        content = fallbackContent
    }

    if (profileData === null) {
        logger.error('[profile.page] getProfileDetails returned null', {
            module: 'profile',
            userId: user.id,
        })
        content = fallbackContent
    }

    if (profileData && (profileData.privacyStatus === 'not_found' || !profileData.profile?.username)) {
        redirect('/onboarding')
    }

    if (profileData) {
        content = <ProfileShell initialData={profileData} profileId={profileData.profile.id} />
    }

    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-white dark:bg-zinc-950"
        >
            {content}
        </div>
    )
}
