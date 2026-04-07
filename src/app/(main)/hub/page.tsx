import { Suspense } from "react";
import ProjectCardSkeleton from "@/components/projects/ProjectCardSkeleton";
import SimpleHubClient from "@/components/hub/SimpleHubClient";
import { PROJECT_STATUS, PROJECT_TYPE, SORT_OPTIONS } from "@/constants/hub";
import { isHardeningDomainEnabled } from "@/lib/features/hardening";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { getPublicProjectsFeedPage } from "@/lib/projects/public-feed-service";
import { mapPublicProjectToHubProject } from "@/lib/projects/public-feed";

const INITIAL_HUB_FILTERS = {
    status: PROJECT_STATUS.ALL,
    type: PROJECT_TYPE.ALL,
    sort: SORT_OPTIONS.NEWEST,
    tech: [],
    search: undefined,
    includedIds: undefined
};

export async function generateMetadata() {
    return {
        title: 'Hub | Edge',
        description: 'Discover and collaborate on the best side-projects and indie apps.',
        openGraph: {
            title: 'Hub | Edge',
            description: 'Discover and collaborate on the best side-projects and indie apps.',
            type: 'website',
            images: ['/og/hub-card.png'],
        },
        twitter: {
            card: 'summary_large_image',
            title: 'Hub | Edge',
            description: 'Discover and collaborate on the best side-projects and indie apps.',
            images: ['/og/hub-card.png'],
        },
    };
}

export default async function HubPage() {
    const { user } = await getViewerAuthContext();
    const dataHardeningEnabled = isHardeningDomainEnabled("dataV1", user?.id ?? null);
    const initialPageSize = dataHardeningEnabled ? 18 : 24;
    const initialFeedPage = await getPublicProjectsFeedPage(initialPageSize, null);
    const initialData = {
        success: true as const,
        projects: initialFeedPage.projects.map(mapPublicProjectToHubProject),
        nextCursor: initialFeedPage.nextCursor || undefined,
        hasMore: Boolean(initialFeedPage.nextCursor),
    };

    return (
        <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 flex flex-col flex-1">
            <Suspense fallback={
                <div className="h-full min-h-0 overflow-hidden">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <ProjectCardSkeleton key={i} />
                            ))}
                        </div>
                    </div>
                </div>
            }>
                <SimpleHubClient returnUserData={user} initialProjectsPage={initialData} />
            </Suspense>
        </div>
    );
}
