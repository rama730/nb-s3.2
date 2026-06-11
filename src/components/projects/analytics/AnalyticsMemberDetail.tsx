import type { ProjectAnalyticsContextFilters, ProjectAnalyticsMemberDetail as ProjectAnalyticsMemberDetailData } from "@/lib/projects/analytics";
import {
    AnalyticsContextNote,
    AnalyticsEmptyState,
    AnalyticsMetric,
    AnalyticsPersonAvatar,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    TimelineEventRow,
    isWithinAnalyticsDateRange,
    timelineEventMatchesContext,
} from "./AnalyticsShared";

const taskList = (items: ProjectAnalyticsMemberDetailData["currentResponsibilities"], empty: string, max = 6) => (
    <div className="space-y-2">
        {items.length ? (
            <>
            {items.slice(0, max).map((task) => (
                <a
                    key={task.id}
                    className="block rounded-xl border border-zinc-200 bg-white p-2.5 transition hover:border-blue-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500"
                    href={task.actionLink.href}
                >
                    <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">{task.title}</p>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{task.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{task.ageDays} days in this state</p>
                </a>
            ))}
            {items.length > max ? (
                <p className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
                    Showing {max} of {items.length}. Use Tasks or Timeline for the full detailed list.
                </p>
            ) : null}
            </>
        ) : (
            <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-800">{empty}</p>
        )}
    </div>
);

export function AnalyticsMemberDetail({
    detail,
    context,
    onBack,
}: {
    detail: ProjectAnalyticsMemberDetailData;
    context: ProjectAnalyticsContextFilters;
    onBack: () => void;
}) {
    const fileContextMatches = context.source === "all" || context.source === "files";
    const visibleFiles = fileContextMatches ? detail.fileContribution.slice(0, 4) : [];
    const hiddenFileCount = fileContextMatches ? Math.max(0, detail.fileContributionTotal - visibleFiles.length) : 0;
    const focusedActivity = detail.collaborationActivity.filter((event) => timelineEventMatchesContext(event, context));
    const taskContextMatches = context.source === "all" || context.source === "tasks" || context.source === "workflow";
    const currentResponsibilities = taskContextMatches
        ? detail.currentResponsibilities.filter((task) => isWithinAnalyticsDateRange(task.updatedAt, context.dateRange))
        : [];
    const pendingWork = taskContextMatches
        ? detail.pendingWork.filter((task) => isWithinAnalyticsDateRange(task.updatedAt, context.dateRange))
        : [];
    const blockedWork = taskContextMatches
        ? detail.blockedWork.filter((task) => isWithinAnalyticsDateRange(task.updatedAt, context.dateRange))
        : [];
    const completedWork = taskContextMatches
        ? detail.completedWork.filter((task) => isWithinAnalyticsDateRange(task.updatedAt, context.dateRange))
        : [];

    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={detail.person.name} />
            <AnalyticsShellCard>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <AnalyticsPersonAvatar person={detail.person} size="md" />
                        <div className="min-w-0">
                            <h3 className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">{detail.person.name}</h3>
                            <p className="mt-0.5 text-xs text-zinc-500">{detail.person.subtext}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                    >
                        Back to members
                    </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <AnalyticsMetric label="Active" value={currentResponsibilities.length} />
                    <AnalyticsMetric label="Pending" value={pendingWork.length} />
                    <AnalyticsMetric label="Blocked" value={blockedWork.length} />
                    <AnalyticsMetric label="Completed" value={completedWork.length} />
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Current lane</p>
                        <p className="mt-1 text-zinc-500">{currentResponsibilities.length ? `${currentResponsibilities.length} active responsibilities` : "No active responsibility load."}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Support lane</p>
                        <p className="mt-1 text-zinc-500">{blockedWork.length ? `${blockedWork.length} blocked item needs help.` : "No blocked work signal."}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">File lane</p>
                        <p className="mt-1 text-zinc-500">{detail.fileContributionTotal ? `${detail.fileContributionTotal} file contribution records.` : "No file contribution yet."}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Movement lane</p>
                        <p className="mt-1 text-zinc-500">{focusedActivity.length ? `${focusedActivity.length} matching timeline events.` : "No matching movement in this context."}</p>
                    </div>
                </div>
            </AnalyticsShellCard>

            <div className="grid gap-3 xl:grid-cols-2">
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Current responsibilities" description="Active tasks currently connected to this member." />
                    <div className="mt-3">{taskList(currentResponsibilities, "No active responsibilities matched this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Blocked or waiting" description="Work that may need help, review, or a decision." />
                    <div className="mt-3">{taskList(blockedWork, "No blocked work matched this context.")}</div>
                </AnalyticsShellCard>
            </div>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader title="Sprint and file contribution" description="Where this member appears across sprint work and file versions." />
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                        {detail.sprintParticipation.length ? detail.sprintParticipation.map((sprint) => (
                            <div key={sprint.sprintId} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                                <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{sprint.sprintName}</p>
                                <p className="mt-1 text-xs text-zinc-500">{sprint.active} active, {sprint.completed} completed</p>
                            </div>
                        )) : <AnalyticsEmptyState title="No sprint footprint" description="Sprint participation will appear once this member is attached to sprint tasks." />}
                    </div>
                    <div className="space-y-2">
	                        {visibleFiles.length ? visibleFiles.map((file) => (
	                            <a key={file.fileId} href={file.actionLink.href} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-2.5 hover:border-blue-300 dark:border-zinc-800 dark:hover:border-blue-500">
	                                <div className="min-w-0">
	                                    <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{file.fileName}</p>
	                                    <p className="mt-0.5 text-[11px] text-zinc-500">{new Date(file.latestChangedAt).toLocaleDateString()} · {file.source}</p>
	                                </div>
	                                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{file.versions} versions</span>
	                            </a>
	                        )) : <AnalyticsEmptyState title="No file contribution" description="Uploads and version changes by this member will appear here." />}
	                        {hiddenFileCount > 0 ? (
	                            <p className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
	                                Showing 4 of {detail.fileContributionTotal}. Open Files analytics or the Files tab for the full workspace instead of rendering a long linear list.
	                            </p>
	                        ) : null}
                    </div>
                </div>
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader title="Member activity" description="Recent chronological movement connected to this member." />
                <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                    {focusedActivity.length ? focusedActivity.map((event) => (
                        <TimelineEventRow key={event.id} event={event} />
                    )) : <AnalyticsEmptyState title="No member activity yet" description="No member activity matched the current analytics context." />}
                </div>
            </AnalyticsShellCard>
        </div>
    );
}
