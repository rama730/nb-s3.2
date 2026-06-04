import PeopleHubClient from '@/components/people/PeopleHubClient'
import { Suspense } from 'react'
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

async function ResolvedPeople({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>> | undefined;
}) {
    const { user } = await getViewerAuthContext();
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const peopleHardeningEnabled = isHardeningDomainEnabled("peopleV1", user?.id ?? null);
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
        <PeopleHubClient
            initialUser={user ? { id: user.id } : null}
            initialApplications={initialApplications}
            // Other heavy lists (profiles, connections) remain lazy loaded for TTFB
        />
    )
}

export default function PeoplePage({ searchParams }: PeoplePageProps) {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-zinc-50 dark:bg-black"
        >
            <Suspense fallback={<div className="h-full flex items-center justify-center animate-pulse text-zinc-500">Loading people...</div>}>
                <ResolvedPeople searchParams={searchParams} />
            </Suspense>
        </div>
    )
}
