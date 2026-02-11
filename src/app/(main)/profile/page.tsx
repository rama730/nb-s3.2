import { redirect } from 'next/navigation'
import { getProfileDetails } from '@/lib/data/profile'
import ProfileShell from '@/components/profile/ProfileShell'
import { createClient } from '@/lib/supabase/server'

export default async function ProfilePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    let data;
    try {
        data = await getProfileDetails(undefined, { skipHeavyData: true })
    } catch (error) {
        console.error('Profile fetch error:', error)
        redirect('/onboarding')
    }

    if (!data?.profile?.username) {
        redirect('/onboarding')
    }

    return (
        <div className="h-[calc(100vh-var(--header-height,56px))] min-h-0 overflow-hidden bg-white dark:bg-zinc-950">
            <ProfileShell initialData={data} profileId={data.profile.id} />
        </div>
    )
}
