import { createClient } from '@/lib/supabase/server'
import PeopleHubClient from '@/components/people/PeopleHubClient'
import { getMyApplicationsAction, getIncomingApplicationsAction } from '@/app/actions/applications'

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // OPTIMIZATION: Fetch lightweight application data server-side to avoid "Requests" tab spinners
    // This satisfies "Pure Fast Showing" requirement
    const [myAppRes, incomingAppRes] = user ? await Promise.all([
        getMyApplicationsAction(),
        getIncomingApplicationsAction(20, 0)
    ]) : [{ applications: [] }, { applications: [] }];
    
    const initialApplications = {
        my: myAppRes.applications || [],
        incoming: incomingAppRes.applications || []
    };

    return (
        <PeopleHubClient 
            initialUser={user}
            initialApplications={initialApplications}
            // Other heavy lists (profiles, connections) remain lazy loaded for TTFB
        />
    )
}
