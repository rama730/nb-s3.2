import { redirect } from 'next/navigation'
import { getProfileDetails } from '@/lib/data/profile'
import ProfileShell from '@/components/profile/ProfileShell'
import { isHardeningDomainEnabled } from '@/lib/features/hardening'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

export default async function ProfilePage() {
    const { user } = await getViewerAuthContext()

    if (!user) {
        redirect('/login')
    }

    let data;
    try {
        const profileHardeningEnabled = isHardeningDomainEnabled("profileV1", user.id);
        data = await getProfileDetails(undefined, {
            skipHeavyData: profileHardeningEnabled,
            viewerUser: user,
        })
    } catch (error) {
        console.error('Profile fetch error:', error)
        redirect('/onboarding')
    }

    if (!data?.profile?.username) {
        redirect('/onboarding')
    }

    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-white dark:bg-zinc-950"
        >
            <ProfileShell initialData={data} profileId={data.profile.id} />
        </div>
    )
}
