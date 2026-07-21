import { useMemo, useState } from "react";
import type { ProjectAnalyticsContextFilters, ProjectAnalyticsTimelineEvent } from "@/lib/projects/analytics";
import { useProjectAnalyticsTimeline } from "@/hooks/hub/useProjectAnalyticsData";
import {
    AnalyticsEmptyState,
    AnalyticsLoadingState,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    TimelineEventRow,
} from "./AnalyticsShared";

const EVENT_TYPES: Array<ProjectAnalyticsTimelineEvent["type"] | "all"> = [
    "all",
    "task",
    "sprint",
    "file",
    "member",
    "application",
    "workflow",
    "settings",
];

type TimelineGroupEntry =
    | { kind: "event"; event: ProjectAnalyticsTimelineEvent }
    | { kind: "summary"; id: string; title: string; description: string; occurredAt: string; count: number };

const dayLabel = (date: Date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const compactTimelineEntries = (events: ProjectAnalyticsTimelineEvent[]): TimelineGroupEntry[] => {
    const fileGroups = new Map<string, ProjectAnalyticsTimelineEvent[]>();
    const passthrough: ProjectAnalyticsTimelineEvent[] = [];
    for (const event of events) {
        if (event.type !== "file" || event.groupedCount) {
            passthrough.push(event);
            continue;
        }
        const key = event.actor?.id ?? "unknown";
        const group = fileGroups.get(key);
        if (group) {
            group.push(event);
        } else {
            fileGroups.set(key, [event]);
        }
    }
    const entries: TimelineGroupEntry[] = passthrough.map((event) => ({ kind: "event", event }));
    for (const [actorId, groupedEvents] of fileGroups.entries()) {
        if (groupedEvents.length >= 4) {
            const actorName = groupedEvents[0]?.actor?.name ?? "A collaborator";
            entries.push({
                kind: "summary",
                id: `file-summary:${actorId}:${groupedEvents[0]?.occurredAt}`,
                title: `${groupedEvents.length} file changes`,
                description: `${actorName} changed ${groupedEvents.length} files in this period. Open Files analytics for the detailed workspace view.`,
                occurredAt: groupedEvents[0]?.occurredAt ?? new Date().toISOString(),
                count: groupedEvents.length,
            });
        } else {
            entries.push(...groupedEvents.map((event) => ({ kind: "event" as const, event })));
        }
    }
    return entries.sort((a, b) => {
        const aTime = new Date(a.kind === "event" ? a.event.occurredAt : a.occurredAt).getTime();
        const bTime = new Date(b.kind === "event" ? b.event.occurredAt : b.occurredAt).getTime();
        return bTime - aTime;
    });
};

const groupTimelineByDay = (events: ProjectAnalyticsTimelineEvent[]) => {
    const groups = new Map<string, ProjectAnalyticsTimelineEvent[]>();
    for (const event of events) {
        const date = new Date(event.occurredAt);
        const key = Number.isNaN(date.getTime()) ? "Unknown" : date.toDateString();
        const group = groups.get(key);
        if (group) {
            group.push(event);
        } else {
            groups.set(key, [event]);
        }
    }
    return [...groups.entries()].map(([id, groupEvents]) => {
        const firstDate = new Date(groupEvents[0]?.occurredAt ?? Date.now());
        return {
            id,
            label: Number.isNaN(firstDate.getTime()) ? "Unknown date" : dayLabel(firstDate),
            entries: compactTimelineEntries(groupEvents),
        };
    });
};

export function AnalyticsTimeline({
    projectId,
    context,
}: {
    projectId: string;
    context: ProjectAnalyticsContextFilters;
}) {
    const [type, setType] = useState<ProjectAnalyticsTimelineEvent["type"] | "all">("all");
    const [limit, setLimit] = useState(40);
    const dateFrom = useMemo(() => {
        if (context.dateRange === "all") return null;
        const days = context.dateRange === "7d" ? 7 : context.dateRange === "90d" ? 90 : 30;
        const date = new Date();
        date.setDate(date.getDate() - days);
        return date.toISOString();
    }, [context.dateRange]);
    const filters = useMemo(() => ({
        type,
        source: context.source,
        memberId: context.memberId,
        dateFrom,
        dateTo: null,
        limit,
    }), [context.memberId, context.source, dateFrom, limit, type]);
    const timelineQuery = useProjectAnalyticsTimeline(projectId, filters);
    if (timelineQuery.isLoading) return <AnalyticsLoadingState label="Loading project timeline..." />;
    const timeline = timelineQuery.data;
    const grouped = groupTimelineByDay(timeline?.items ?? []);

    return (
        <div className="space-y-3">
            <AnalyticsShellCard>
                <AnalyticsSectionHeader
                    eyebrow="Timeline"
                    title="Chronological project movement"
                    description="Task, sprint, file, member, application, workflow, and settings activity normalized into one project trail."
                />
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {EVENT_TYPES.map((eventType) => (
                        <button
                            key={eventType}
                            type="button"
                            onClick={() => {
                                setType(eventType);
                                setLimit(40);
                            }}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                type === eventType
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            }`}
                        >
                    {eventType === "all" ? "All" : eventType}
                        </button>
                    ))}
                </div>
            </AnalyticsShellCard>

            <AnalyticsShellCard>
                <div className="space-y-4">
                    {grouped.length ? (
                        grouped.map((group) => (
                            <section key={group.id}>
                                <div className="mb-2 flex items-center gap-3">
                                    <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{group.label}</h3>
                                    <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                                    <span className="text-[11px] text-zinc-500">{group.entries.length} movements</span>
                                </div>
                                <div className="relative border-l border-zinc-200 dark:border-zinc-800 pl-6 ml-3.5 space-y-6 mt-3 pb-2">
                                    {group.entries.map((entry) => (
                                        entry.kind === "summary" ? (
                                            <article key={entry.id} className="relative pl-0 py-1 text-xs">
                                                <div className="absolute -left-[38px] top-0.5 z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="font-semibold text-zinc-950 dark:text-zinc-50 text-sm">{entry.title}</p>
                                                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{entry.count} grouped</span>
                                                    </div>
                                                    <p className="mt-1 text-zinc-500 leading-relaxed">{entry.description}</p>
                                                </div>
                                            </article>
                                        ) : (
                                            <TimelineEventRow key={entry.event.id} event={entry.event} />
                                        )
                                    ))}
                                </div>
                            </section>
                        ))
                    ) : (
                        <AnalyticsEmptyState
                            title="No timeline events"
                            description="No events matched this filter. Try another event type or wait for more project movement."
                        />
                    )}
                </div>
                {timeline?.nextCursor ? (
                    <div className="mt-5 flex justify-center">
                        <button
                            type="button"
                            onClick={() => setLimit((current) => current + 40)}
                            className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-blue-500"
                        >
                            Load more movement
                        </button>
                    </div>
                ) : null}
            </AnalyticsShellCard>
        </div>
    );
}
