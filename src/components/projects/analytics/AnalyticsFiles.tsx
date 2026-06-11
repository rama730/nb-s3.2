import type { ProjectAnalyticsContextFilters, ProjectAnalyticsFileRef } from "@/lib/projects/analytics";
import { useProjectAnalyticsFiles } from "@/hooks/hub/useProjectAnalyticsData";
import {
    AnalyticsActionLink,
    AnalyticsContextNote,
    AnalyticsEmptyState,
    AnalyticsLoadingState,
    AnalyticsMetric,
    AnalyticsPersonAvatar,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    isWithinAnalyticsDateRange,
} from "./AnalyticsShared";

const fileList = (items: ProjectAnalyticsFileRef[], empty: string, max = 4) => (
    <div className="space-y-2">
        {items.length ? items.slice(0, max).map((file) => (
            <a key={file.id} href={file.actionLink.href} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 transition hover:border-blue-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">{file.name}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{file.source} · {file.publicVisible ? "public" : "private"}</p>
                </div>
                <p className="shrink-0 text-[11px] text-zinc-500">{new Date(file.updatedAt).toLocaleDateString()}</p>
            </a>
        )) : <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-800">{empty}</p>}
        {items.length > max ? <p className="px-1 text-[11px] text-zinc-500">Showing {max} of {items.length}. Open Files for the full workspace list.</p> : null}
    </div>
);

const filesForContext = (items: ProjectAnalyticsFileRef[], context: ProjectAnalyticsContextFilters) => {
    if (context.source !== "all" && context.source !== "files") return [];
    return items.filter((file) => {
        if (context.memberId && file.contributorId !== context.memberId) return false;
        return isWithinAnalyticsDateRange(file.updatedAt, context.dateRange);
    });
};

export function AnalyticsFiles({
    projectId,
    context,
    memberName,
}: {
    projectId: string;
    context: ProjectAnalyticsContextFilters;
    memberName?: string | null;
}) {
    const filesQuery = useProjectAnalyticsFiles(projectId, context);
    if (filesQuery.isLoading) return <AnalyticsLoadingState label="Loading file intelligence..." />;
    const files = filesQuery.data;
    if (!files) {
        return (
            <AnalyticsShellCard>
                <AnalyticsEmptyState title="File intelligence unavailable" description="We could not load file analytics for this project." />
            </AnalyticsShellCard>
        );
    }
    const active = filesForContext(files.active, context);
    const needsReview = filesForContext(files.needsReview, context);
    const recentlyChanged = filesForContext(files.recentlyChanged, context);
    const linkedToWork = filesForContext(files.linkedToWork, context);
    const possiblyStale = filesForContext(files.possiblyStale, context);
    const batches = files.activityBatches.filter((batch) => {
        if (context.source !== "all" && context.source !== "files") return false;
        if (context.memberId && batch.contributor?.id !== context.memberId) return false;
        return isWithinAnalyticsDateRange(batch.occurredAt, context.dateRange);
    });
    const memberContributions = context.memberId
        ? files.memberContributions.filter((entry) => entry.person.id === context.memberId)
        : files.memberContributions;
    const typeSummary = [...active.reduce((map, file) => {
        const type = file.type || "file";
        map.set(type, (map.get(type) ?? 0) + 1);
        return map;
    }, new Map<string, number>()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={memberName} />
            <AnalyticsShellCard>
                <AnalyticsSectionHeader
                    eyebrow="Files & Workspace"
                    title="Asset movement and review debt"
                    description="File intelligence connects uploads, versions, task links, and review annotations back to the workspace."
                />
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <AnalyticsMetric label="Active files" value={active.length} />
                    <AnalyticsMetric label="Needs review" value={needsReview.length} />
                    <AnalyticsMetric label="Recently changed" value={recentlyChanged.length} />
                    <AnalyticsMetric label="Linked to work" value={linkedToWork.length} />
                    <AnalyticsMetric label="Possibly stale" value={possiblyStale.length} />
                </div>
                {typeSummary.length ? (
                    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Workspace mix</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {typeSummary.map(([type, count]) => (
                                <span key={type} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                                    {count} {type}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader title="File activity batches" description="Large file movement is summarized into batches so Analytics does not become a second file explorer." />
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
	                    {batches.length ? batches.slice(0, 4).map((batch) => (
                        <article key={batch.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                            <div className="flex items-start gap-2.5">
                                {batch.contributor ? <AnalyticsPersonAvatar person={batch.contributor} size="xs" /> : null}
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{batch.label}</p>
                                    <p className="mt-1 text-zinc-500">{batch.contributor?.name ?? "Unknown contributor"} · {new Date(batch.occurredAt).toLocaleDateString()}</p>
                                </div>
                                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-semibold text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">{batch.versions} versions</span>
                            </div>
                            <div className="mt-2.5">
                                <AnalyticsActionLink link={batch.actionLink} />
                            </div>
                        </article>
                    )) : <AnalyticsEmptyState title="No file batches" description="No grouped file activity matched the current analytics context." />}
                </div>
            </AnalyticsShellCard>

            <div className="grid gap-3 xl:grid-cols-2">
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Needs review" description="Files linked with review annotations." />
                    <div className="mt-3">{fileList(needsReview, "No files currently need review in this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Recently changed" description="Workspace files with recent movement." />
                    <div className="mt-3">{fileList(recentlyChanged, "No files changed recently in this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Linked to work" description="Files connected to tasks." />
                    <div className="mt-3">{fileList(linkedToWork, "No files are linked to tasks in this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Possibly stale" description="Older files that are not linked to active work." />
                    <div className="mt-3">{fileList(possiblyStale, "No stale file signals found in this context.")}</div>
                </AnalyticsShellCard>
            </div>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader title="Member file contribution" description="Uploads and version changes by active collaborators." />
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {memberContributions.length ? memberContributions.slice(0, 4).map((entry) => (
                        <div key={entry.person.id} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                            <div className="flex items-center gap-2.5">
                                <AnalyticsPersonAvatar person={entry.person} />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{entry.person.name}</p>
                                    <p className="mt-1 text-xs text-zinc-500">{entry.files} files, {entry.versions} versions</p>
                                </div>
                            </div>
                        </div>
                    )) : <AnalyticsEmptyState title="No file contributors yet" description="No member upload or version contribution matched the current context." />}
                    {memberContributions.length > 4 ? (
                        <p className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                            Showing 4 of {memberContributions.length}. Open the Files tab for the full workspace.
                        </p>
                    ) : null}
                </div>
            </AnalyticsShellCard>
        </div>
    );
}
