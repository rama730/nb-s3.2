import type { ProjectAnalyticsContextFilters } from "@/lib/projects/analytics";
import { useProjectAnalyticsSprints } from "@/hooks/hub/useProjectAnalyticsData";
import {
    AnalyticsContextNote,
    AnalyticsEmptyState,
    AnalyticsLoadingState,
    AnalyticsMetric,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    isWithinAnalyticsDateRange,
} from "./AnalyticsShared";

export function AnalyticsSprints({
    projectId,
    context,
    memberName,
}: {
    projectId: string;
    context: ProjectAnalyticsContextFilters;
    memberName?: string | null;
}) {
    const sprintsQuery = useProjectAnalyticsSprints(projectId, context);
    if (sprintsQuery.isLoading) return <AnalyticsLoadingState label="Loading sprint intelligence..." />;
    const sprints = (sprintsQuery.data ?? []).filter((sprint) => {
        if (context.source !== "all" && context.source !== "sprints") return false;
        return isWithinAnalyticsDateRange(sprint.endDate ?? sprint.startDate, context.dateRange);
    });

    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={memberName} />
            <AnalyticsShellCard>
                <AnalyticsSectionHeader
                    eyebrow="Sprint Rhythm"
                    title="Sprint stories, not percentage theater"
                    description="Each sprint summarizes the actual work attached to it and the deterministic story we can safely tell from available data."
                />
            </AnalyticsShellCard>

            {sprints.length ? (
                <div className="grid gap-2 xl:grid-cols-2">
                    {sprints.map((sprint) => (
                        <a key={sprint.id} href={sprint.actionLink.href} className="block rounded-2xl border border-zinc-200 bg-white p-3 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{sprint.name}</h3>
                                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{sprint.status}</span>
                                    </div>
                                    <p className="mt-1.5 max-w-2xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">{sprint.story}</p>
                                </div>
                                <div className="text-[11px] text-zinc-500">
                                    {sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : "No start"} - {sprint.endDate ? new Date(sprint.endDate).toLocaleDateString() : "No end"}
                                </div>
                            </div>
                            <div className="mt-3 grid gap-1.5 sm:grid-cols-5">
                                <AnalyticsMetric label="Planned" value={sprint.planned} />
                                <AnalyticsMetric label="Active" value={sprint.active} />
                                <AnalyticsMetric label="Completed" value={sprint.completed} />
                                <AnalyticsMetric label="Blocked" value={sprint.blocked} />
                                <AnalyticsMetric label="Carry-forward" value={sprint.carriedForward} />
                            </div>
                        </a>
                    ))}
                </div>
            ) : (
                <AnalyticsShellCard>
                    <AnalyticsEmptyState title="No sprint intelligence yet" description="No sprint stories matched the current analytics context." />
                </AnalyticsShellCard>
            )}
        </div>
    );
}
