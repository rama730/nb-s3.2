import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { cache, Suspense } from 'react';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import { readProjectDetailMetadata, readProjectDetailShell, readProjectSprintDetail } from '@/app/actions/project/_all';
import { isHardeningDomainEnabled } from '@/lib/features/hardening';
import { getViewerAuthContext, getViewerProfileContext, toClientViewer } from '@/lib/server/viewer-context';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { buildProjectDetailMetadataInput } from '@/lib/projects/project-detail-metadata';
import { isProjectTabVisibleToViewer } from '@/lib/projects/settings-policies';
import { readProjectFileMetadataTitle, readProjectTaskMetadataTitle } from '@/lib/projects/project-detail-metadata-lookup';

const readProjectDetailMetadataCached = cache((slugOrId: string, actorUserId: string | null) => readProjectDetailMetadata({ slugOrId, actorUserId }));
const readProjectDetailShellCached = cache((slugOrId: string, actorUserId: string | null) => readProjectDetailShell({ slugOrId, actorUserId }));
const readProjectSprintDetailCached = cache((slugOrId: string, actorUserId: string | null, limit?: number, sprintId?: string) => readProjectSprintDetail({ slugOrId, actorUserId, limit, sprintId }));

export async function generateMetadata({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{
        tab?: string;
        fileId?: string;
        drawerType?: string;
        drawerId?: string;
        panelTab?: string;
    }>;
}): Promise<Metadata> {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    const { user } = await getViewerAuthContext();
    const result = await readProjectDetailMetadataCached(slug, user?.id ?? null);
    if (!result.success) {
        return buildRouteMetadata({
            title: "Project unavailable | Edge",
            description: "This project is private or unavailable.",
            path: `/projects/${encodeURIComponent(slug)}`,
        });
    }
    const project = result.data;
    const metadataInput = buildProjectDetailMetadataInput(slug, project);

    const tab = _searchParams?.tab || "dashboard";
    const tabTitleMap: Record<string, string> = {
        updates: "Project Feed",
        sprints: "Sprints",
        analytics: "Project Analytics",
        settings: "Settings",
        readme: "Docs",
        docs: "Docs",
    };
    let tabTitle = tabTitleMap[tab] ?? "";

    if (tab === "files") {
        tabTitle = "Files";
        const fileId = _searchParams?.fileId;
        if (fileId) {
            try {
                const fileTitle = await readProjectFileMetadataTitle(project.projectId, fileId);
                if (fileTitle) {
                    tabTitle = `${fileTitle} | Files`;
                }
            } catch (e) {
                // Ignore query error, fallback to 'Files'
            }
        }
    } else if (tab === "tasks") {
        tabTitle = "Tasks";
        const drawerType = _searchParams?.drawerType;
        const drawerId = _searchParams?.drawerId;
        if (drawerType === "task" && drawerId) {
            try {
                const taskTitle = await readProjectTaskMetadataTitle(project.projectId, drawerId);
                if (taskTitle) {
                    tabTitle = `${taskTitle} | Tasks`;
                }
            } catch (e) {
                // Ignore query error, fallback to 'Tasks'
            }
        }
    }

    if (tabTitle) {
        metadataInput.title = `${tabTitle} | ${project.title} | Edge`;
    }

    return buildRouteMetadata(metadataInput);
}

async function ResolvedProjectDashboard({
    params,
    searchParams
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ tab?: string; updateId?: string; commentId?: string; sprintId?: string }>;
}) {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    const selectedTab = _searchParams?.tab || "dashboard";
    const sprintId = _searchParams?.sprintId;
    const viewer = await getViewerProfileContext();
    const { user } = viewer;
    const clientViewer = toClientViewer(viewer);

    const result = await readProjectDetailShellCached(slug, user?.id ?? null);

    if (!result.success) {
        if (result.errorCode === 'NOT_FOUND' || result.errorCode === 'FORBIDDEN') {
            notFound();
        }
        throw new Error(`[ProjectDetailPage] ${result.errorCode}: ${result.message}`);
    }

    const { project, capabilities } = result.data;
    const canViewSprints = isProjectTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: capabilities.isOwner || capabilities.isMember,
        publicTabVisibility: project.publicTabVisibility,
    });
    const sprintResult = selectedTab === "sprints" && canViewSprints
        ? await readProjectSprintDetailCached(slug, user?.id ?? null, 24, sprintId)
        : null;

    const dataHardeningEnabled = isHardeningDomainEnabled('dataV1', user?.id ?? null);
    const filesHardeningEnabled = isHardeningDomainEnabled('filesV1', user?.id ?? null);
    const peopleHardeningEnabled = isHardeningDomainEnabled('peopleV1', user?.id ?? null);

    return (
        <div
            className="h-full min-h-0 flex flex-col"
            data-hardening-data={dataHardeningEnabled ? "v1" : "off"}
            data-hardening-files={filesHardeningEnabled ? "v1" : "off"}
            data-hardening-people={peopleHardeningEnabled ? "v1" : "off"}
        >
            <ProjectDashboardClient
                project={project}
                currentUserId={user?.id || null}
                viewerDisplayName={clientViewer.displayName}
                viewerAvatarUrl={clientViewer.avatarUrl}
                isOwner={capabilities.isOwner}
                isMember={capabilities.isMember}
                initialSprintData={sprintResult && sprintResult.success ? sprintResult.data : null}
            />
        </div>
    );
}

export default function ProjectDetailPage({
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
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-zinc-50 dark:bg-zinc-950"
        >
            <Suspense fallback={<div className="h-full flex items-center justify-center animate-pulse text-zinc-500">Loading project data...</div>}>
                <ResolvedProjectDashboard params={params} searchParams={searchParams} />
            </Suspense>
        </div>
    );
}
