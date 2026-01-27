import { createClient } from '@/lib/supabase/server'
import PeopleHubClient from '@/components/people/PeopleHubClient'
import { getSuggestedPeople, getConnectionStats, getPendingRequests } from '@/app/actions/connections'

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Parallel data fetching for speed
    const [suggestedData, stats, requests] = await Promise.all([
        getSuggestedPeople(20, 0),
        getConnectionStats(user?.id),
        getPendingRequests()
    ]);

    return (
        <PeopleHubClient 
            initialUser={user}
            initialProfiles={suggestedData.profiles}
            connectionStats={stats}
            initialRequests={requests}
        />
    )
}
