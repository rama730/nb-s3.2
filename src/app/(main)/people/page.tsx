import { createClient } from '@/lib/supabase/server'
import PeopleHubClient from '@/components/people/PeopleHubClient'
import { getMyApplicationsAction, getIncomingApplicationsAction } from '@/app/actions/applications'

export const dynamic = 'force-dynamic';

interface PeoplePageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const tabParam = typeof resolvedSearchParams?.tab === 'string'
        ? resolvedSearchParams.tab.toLowerCase()
        : '';

    // Only prefetch heavy request/applications payload when Requests tab is explicitly requested.
    const shouldPrefetchApplications = !!user && tabParam === 'requests';
    const [myAppRes, incomingAppRes] = shouldPrefetchApplications
        ? await Promise.all([getMyApplicationsAction(), getIncomingApplicationsAction(20, 0)])
        : [{ applications: [] }, { applications: [] }];
    
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
