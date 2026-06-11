import type { ProjectAnalyticsContextFilters, ProjectAnalyticsTaskRef } from "@/lib/projects/analytics";
import { useProjectAnalyticsWorkflow } from "@/hooks/hub/useProjectAnalyticsData";
import {
    AnalyticsContextNote,
    AnalyticsEmptyState,
    AnalyticsInsightCard,
    AnalyticsLoadingState,
    AnalyticsMetric,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    isWithinAnalyticsDateRange,
} from "./AnalyticsShared";

const taskList = (items: ProjectAnalyticsTaskRef[], empty: string, max = 4) => (
    <div className="space-y-2">
        {items.length ? (
            <>
            {items.slice(0, max).map((task) => (
            <a key={task.id} href={task.actionLink.href} className="block rounded-xl border border-zinc-200 bg-white p-2.5 transition hover:border-blue-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500">
                <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">{task.title}</p>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{task.status}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{task.assigneeName}</p>
            </a>
            ))}
            {items.length > max ? (
                <p className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
                    Showing {max} of {items.length}. Open Tasks for the full work queue.
                </p>
            ) : null}
            </>
        ) : <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-800">{empty}</p>}
    </div>
);

const workflowItemsForContext = (items: ProjectAnalyticsTaskRef[], context: ProjectAnalyticsContextFilters) => {
    if (context.source !== "all" && context.source !== "tasks" && context.source !== "workflow") return [];
    return items.filter((task) => {
        if (context.memberId && task.assigneeId !== context.memberId) return false;
        return isWithinAnalyticsDateRange(task.updatedAt, context.dateRange);
    });
};

export function AnalyticsWorkflow({
    projectId,
    context,
    memberName,
}: {
    projectId: string;
    context: ProjectAnalyticsContextFilters;
    memberName?: string | null;
}) {
    const workflowQuery = useProjectAnalyticsWorkflow(projectId, context);
    if (workflowQuery.isLoading) return <AnalyticsLoadingState label="Loading workflow intelligence..." />;
    const workflow = workflowQuery.data;
    if (!workflow) {
        return (
            <AnalyticsShellCard>
                <AnalyticsEmptyState title="Workflow intelligence unavailable" description="We could not load task flow data for this project." />
            </AnalyticsShellCard>
        );
    }
    const statuses = Object.entries(workflow.statusCounts);
    const blocked = workflowItemsForContext(workflow.blocked, context);
    const unassigned = workflowItemsForContext(workflow.unassigned, context);
    const stale = workflowItemsForContext(workflow.stale, context);
    const removedMemberAssignments = workflowItemsForContext(workflow.removedMemberAssignments, context);
    const showFriction = context.source === "all" || context.source === "tasks" || context.source === "workflow";

    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={memberName} />
            <AnalyticsShellCard>
                <AnalyticsSectionHeader
                    eyebrow="Workflow"
                    title="Task movement and friction"
                    description="Flow intelligence uses current task state and timestamps, and avoids claiming transition history when no event exists."
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {statuses.length ? statuses.map(([status, count]) => (
                        <AnalyticsMetric key={status} label={status.replaceAll("_", " ")} value={count} />
                    )) : <AnalyticsMetric label="Tasks" value={0} description="No task records yet." />}
                </div>
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader title="Flow friction" description="Support-oriented signals for stuck, unassigned, or hard-to-finish work." />
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                    {showFriction && workflow.friction.length ? workflow.friction.map((insight) => (
                        <AnalyticsInsightCard key={insight.id} insight={insight} />
                    )) : <AnalyticsEmptyState title="No flow friction detected" description="No blocked, stale, or former-assignee task signals matched the current context." />}
                </div>
            </AnalyticsShellCard>

            <div className="grid gap-3 xl:grid-cols-2">
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Blocked" description="Tasks explicitly marked as blocked." />
                    <div className="mt-3">{taskList(blocked, "No blocked tasks matched this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Unassigned" description="Active work without a clear assignee." />
                    <div className="mt-3">{taskList(unassigned, "No unassigned active tasks matched this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Stale" description="Active tasks that have not moved recently." />
                    <div className="mt-3">{taskList(stale, "No stale active tasks matched this context.")}</div>
                </AnalyticsShellCard>
                <AnalyticsShellCard>
                    <AnalyticsSectionHeader title="Needs reassignment" description="Active tasks still assigned to former collaborators." />
                    <div className="mt-3">{taskList(removedMemberAssignments, "No former-member assignments matched this context.")}</div>
                </AnalyticsShellCard>
            </div>
        </div>
    );
}
