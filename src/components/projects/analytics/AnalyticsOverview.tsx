import type { ProjectAnalyticsContextFilters, ProjectAnalyticsOverview as ProjectAnalyticsOverviewData } from "@/lib/projects/analytics";
import {
    AnalyticsContextNote,
    AnalyticsCoverageNote,
    AnalyticsEmptyState,
    AnalyticsInsightCard,
    AnalyticsMetric,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    TimelineEventRow,
    timelineEventMatchesContext,
} from "./AnalyticsShared";

export function AnalyticsOverview({
    overview,
    context,
    memberName,
}: {
    overview: ProjectAnalyticsOverviewData;
    context: ProjectAnalyticsContextFilters;
    memberName?: string | null;
}) {
    const focusedMovement = overview.recentMovement.filter((event) => timelineEventMatchesContext(event, context));
    const pulseNarrative = overview.pulse.blockedWork > 0
        ? "The project is moving, but blocked work should be handled before adding more load."
        : overview.pulse.pendingReviews > 0
            ? "The project is active with review debt waiting in the file workspace."
            : overview.pulse.recentMovement === 0 && overview.pulse.activeWork > 0
                ? "The project has active work, but recent movement is quiet."
                : "The project currently looks steady from the available records.";
    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={memberName} />
            <AnalyticsShellCard>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <AnalyticsSectionHeader
                        eyebrow="Today's Focus"
                        title="Next moves"
                        description="The shortest path from the current project state to the next useful action."
                    />
                    <div className="max-w-md rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                        {pulseNarrative}
                    </div>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-4">
                    {(overview.nextMoves.length ? overview.nextMoves : overview.commandCenter).map((insight) => (
                        <AnalyticsInsightCard key={insight.id} insight={insight} />
                    ))}
                </div>
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader
                    eyebrow="Project Pulse"
                    title="Current project movement"
                    description="A compact operational read built from tasks, sprints, visible files, and recent project activity."
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <AnalyticsMetric label="Active work" value={overview.pulse.activeWork} description="Tasks still moving through the project." />
                    <AnalyticsMetric label="Completed" value={overview.pulse.completedWork} description="Work already closed from the current project data." />
                    <AnalyticsMetric label="Blocked" value={overview.pulse.blockedWork} description="Tasks that need help before they can move." />
                    <AnalyticsMetric label="Recent movement" value={overview.pulse.recentMovement} description="Task updates detected in the last seven days." />
                </div>
                <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-xs dark:border-blue-900/60 dark:bg-blue-950/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-200">Compare mode</p>
                            <p className="mt-1 font-semibold text-blue-950 dark:text-blue-100">{overview.comparison.label}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-blue-800 dark:text-blue-200">
                            <span className="rounded-full bg-white/70 px-2 py-0.5 dark:bg-black/20">Movement {overview.comparison.movementDelta >= 0 ? "+" : ""}{overview.comparison.movementDelta}</span>
                            <span className="rounded-full bg-white/70 px-2 py-0.5 dark:bg-black/20">Completed {overview.comparison.completedDelta >= 0 ? "+" : ""}{overview.comparison.completedDelta}</span>
                        </div>
                    </div>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1.2fr]">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Source coverage</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                            <span>{overview.sourceSummary.tasks} tasks</span>
                            <span>{overview.sourceSummary.members} members</span>
                            <span>{overview.sourceSummary.sprints} sprints</span>
                            <span>{overview.sourceSummary.files} files</span>
                            {typeof overview.sourceSummary.githubFiles === "number" ? <span>{overview.sourceSummary.githubFiles} GitHub</span> : null}
                            {typeof overview.sourceSummary.manualFiles === "number" ? <span>{overview.sourceSummary.manualFiles} manual</span> : null}
                            {typeof overview.sourceSummary.events === "number" ? <span>{overview.sourceSummary.events} events</span> : null}
                        </div>
                    </div>
                    <AnalyticsCoverageNote sourceSummary={overview.sourceSummary} />
                </div>
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <AnalyticsSectionHeader
                    eyebrow="Support Signals"
                    title="What may need attention"
                    description="Small decision, review, or unblock signals. These are not leaderboard or blame signals."
                />
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                    {overview.needsAttention.map((insight) => (
                        <AnalyticsInsightCard key={insight.id} insight={insight} />
                    ))}
                </div>
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <AnalyticsSectionHeader
                        eyebrow="Recent Moments"
                        title="Newest meaningful movement"
                        description="A four-item snapshot. Open Timeline when you need the full chronological trail."
                    />
                    <a
                        href="?tab=analytics&analyticsTab=timeline"
                        className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                    >
                        Open timeline
                    </a>
                </div>
                <div className="mt-3 rounded-xl border border-zinc-200 bg-white/60 px-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                    {focusedMovement.length ? (
                        focusedMovement.slice(0, 4).map((event) => <TimelineEventRow key={event.id} event={event} />)
                    ) : (
                        <AnalyticsEmptyState
                            title="No movement yet"
                            description="No recent movement matched the current analytics context. Clear filters or open Timeline for a broader view."
                        />
                    )}
                </div>
            </AnalyticsShellCard>
        </div>
    );
}
