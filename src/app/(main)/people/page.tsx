import PeopleHubClient from '@/components/people/PeopleHubClient'
import { Suspense } from 'react'
import { getPeopleApplications } from '@/app/actions/people-applications'
import { isHardeningDomainEnabled } from '@/lib/features/hardening'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Connections | NetworkBase',
        description: 'Discover collaborators, manage your network, and respond to incoming requests on NetworkBase.',
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

    const shouldPrefetchApplications = !!user && tabParam === 'requests' && peopleHardeningEnabled;
    const applications = shouldPrefetchApplications ? await getPeopleApplications(12) : null;
    
    const initialApplications = {
        my: applications?.success ? applications.my : [],
        incoming: applications?.success ? applications.incoming : []
    };

    return (
        <PeopleHubClient
            initialUser={user ? { id: user.id } : null}
            initialApplications={initialApplications}
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
