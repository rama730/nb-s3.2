import PeopleHubClient from '@/components/people/PeopleHubClient'
import { getMyApplicationsAction, getIncomingApplicationsAction } from '@/app/actions/applications'
import { isHardeningDomainEnabled } from '@/lib/features/hardening'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Connections | Edge',
        description: 'Discover collaborators, manage your network, and respond to incoming requests on Edge.',
        path: '/people',
    });
}

interface PeoplePageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
    const { user } = await getViewerAuthContext()
    const peopleHardeningEnabled = isHardeningDomainEnabled("peopleV1", user?.id ?? null);
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const tabParam = typeof resolvedSearchParams?.tab === 'string'
        ? resolvedSearchParams.tab.toLowerCase()
        : '';

    // Only prefetch heavy request/applications payload when Requests tab is explicitly requested.
    const shouldPrefetchApplications = !!user && tabParam === 'requests' && peopleHardeningEnabled;
    const [myAppRes, incomingAppRes] = shouldPrefetchApplications
        ? await Promise.all([
            getMyApplicationsAction({ limit: 12 }),
            getIncomingApplicationsAction({ limit: 12 }),
        ])
        : [{ applications: [] }, { applications: [] }];
    
    const initialApplications = {
        my: myAppRes.applications || [],
        incoming: incomingAppRes.applications || []
    };

    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-zinc-50 dark:bg-black"
        >
            <PeopleHubClient
                initialUser={user}
                initialApplications={initialApplications}
                // Other heavy lists (profiles, connections) remain lazy loaded for TTFB
            />
        </div>
    )
}
