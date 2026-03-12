import { Suspense } from 'react';
import { getWorkspaceOverviewBase } from '@/app/actions/workspace';
import WorkspaceClient from '@/components/workspace/WorkspaceClient';
import WorkspaceSkeleton from '@/components/workspace/WorkspaceSkeleton';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
    return {
        title: 'Workspace | Edge',
        description: 'Your personal command center — tasks, projects, messages, and more.',
    };
}

export default async function WorkspacePage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const resolvedParams = await searchParams;
    const initialTab = typeof resolvedParams.tab === 'string' ? resolvedParams.tab : 'overview';

    // Server-prefetch base overview data (layout + counters + lightweight refs)
    const result = await getWorkspaceOverviewBase();

    return (
        <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
            <Suspense fallback={<WorkspaceSkeleton />}>
                <WorkspaceClient
                    initialData={result.success && result.data ? result.data : null}
                    initialTab={initialTab}
                />
            </Suspense>
        </div>
    );
}
