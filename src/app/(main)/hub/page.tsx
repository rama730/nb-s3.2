import { Suspense } from "react";
import ProjectCardSkeleton from "@/components/projects/ProjectCardSkeleton";
import SimpleHubClient from "@/components/hub/SimpleHubClient";
import { fetchHubProjectsAction } from "@/app/actions/hub";
import { PROJECT_STATUS, PROJECT_TYPE, SORT_OPTIONS } from "@/constants/hub";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic'; // Real-time data fetching

export async function generateMetadata() {
    return {
        title: 'Hub | Edge',
        description: 'Discover and collaborate on the best side-projects and indie apps.',
    };
}

export default async function HubPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Prefetch initial data with default filters
    const initialFilters = {
        status: PROJECT_STATUS.ALL,
        type: PROJECT_TYPE.ALL,
        sort: SORT_OPTIONS.NEWEST,
        tech: [],
        search: undefined,
        includedIds: undefined
    };

    const initialData = await fetchHubProjectsAction(initialFilters, 0, 24);

    return (
        <div className="h-[calc(100vh-var(--header-height,56px))] min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
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
                <SimpleHubClient returnUserData={user} initialProjectsPage={initialData.success ? initialData : null} />
            </Suspense>
        </div>
    );
}
