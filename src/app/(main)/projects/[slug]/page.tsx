import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import { readProjectDetailMetadata, readProjectDetailShell, readProjectSprintDetail } from '@/app/actions/project';
import { isHardeningDomainEnabled } from '@/lib/features/hardening';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { buildProjectDetailMetadataInput, getProjectTitleFromSlug } from '@/lib/projects/project-detail-metadata';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const fallbackTitle = getProjectTitleFromSlug(slug);
    const result = await readProjectDetailMetadata({ slugOrId: slug, actorUserId: null });
    if (!result.success) {
        return buildRouteMetadata({
            title: `${fallbackTitle} | Edge`,
            description: `Explore ${fallbackTitle} on Edge.`,
            path: `/projects/${encodeURIComponent(slug)}`,
        });
    }
    const project = result.data;
    return buildRouteMetadata(buildProjectDetailMetadataInput(slug, project));
}

export default async function ProjectDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{
        tab?: string;
        filter?: string;
        drawerType?: string;
        drawerId?: string;
        panelTab?: string;
    }>;
}) {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);

    const { user } = await getViewerAuthContext();

    const selectedTab = _searchParams?.tab || "dashboard";

    const [result, sprintResult] = await Promise.all([
        readProjectDetailShell({
            slugOrId: slug,
            actorUserId: user?.id ?? null,
        }),
        selectedTab === "sprints"
            ? readProjectSprintDetail({
                slugOrId: slug,
                actorUserId: user?.id ?? null,
                limit: 24,
            })
            : Promise.resolve(null),
    ]);

    if (!result.success) {
        if (result.errorCode === 'NOT_FOUND' || result.errorCode === 'FORBIDDEN') {
            notFound();
        }
        throw new Error(`[ProjectDetailPage] ${result.errorCode}: ${result.message}`);
    }

    const { project, capabilities } = result.data;
    const shellHardeningEnabled = isHardeningDomainEnabled('shellV1', user?.id ?? null);
    const dataHardeningEnabled = isHardeningDomainEnabled('dataV1', user?.id ?? null);
    const filesHardeningEnabled = isHardeningDomainEnabled('filesV1', user?.id ?? null);
    const peopleHardeningEnabled = isHardeningDomainEnabled('peopleV1', user?.id ?? null);

    return (
        <div
            data-scroll-root="route"
            data-hardening-shell={shellHardeningEnabled ? "v1" : "off"}
            data-hardening-data={dataHardeningEnabled ? "v1" : "off"}
            data-hardening-files={filesHardeningEnabled ? "v1" : "off"}
            data-hardening-people={peopleHardeningEnabled ? "v1" : "off"}
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-zinc-50 dark:bg-zinc-950"
        >
            <ProjectDashboardClient
                project={project}
                currentUserId={user?.id || null}
                isOwner={capabilities.isOwner}
                isMember={capabilities.isMember}
                initialSprintData={sprintResult && sprintResult.success ? sprintResult.data : null}
            />
        </div>
    );
}
