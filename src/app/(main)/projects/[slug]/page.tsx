import { notFound } from 'next/navigation';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import { getProjectDetailShellAction } from '@/app/actions/project';
import { isHardeningDomainEnabled } from '@/lib/features/hardening';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

const isUuid = (value: string) =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

function getProjectTitleFromSlug(slug: string) {
    const decoded = decodeURIComponent(slug || '').trim();
    if (!decoded || isUuid(decoded)) return 'Project';
    const normalized = decoded
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized ? normalized.slice(0, 80) : 'Project';
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const title = getProjectTitleFromSlug(slug);

    return {
        title: `${title} | Edge`,
    };
}

export default async function ProjectDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);

    const { user } = await getViewerAuthContext();

    const result = await getProjectDetailShellAction({
        slugOrId: slug,
    });

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
            />
        </div>
    );
}
