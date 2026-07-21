import type React from "react";
import type {
    ProjectAnalyticsActionLink,
    ProjectAnalyticsContextDateRange,
    ProjectAnalyticsContextFilters,
    ProjectAnalyticsInsight,
    ProjectAnalyticsOverview,
    ProjectAnalyticsPerson,
    ProjectAnalyticsTimelineEvent,
} from "@/lib/projects/analytics";

export const ANALYTICS_TAB_COPY = {
    overview: "Overview",
    members: "Members",
    timeline: "Timeline",
} as const;

export const ANALYTICS_DATE_RANGE_OPTIONS: Array<{ id: ProjectAnalyticsContextDateRange; label: string }> = [
    { id: "30d", label: "Last 30 days" },
    { id: "7d", label: "Last 7 days" },
    { id: "90d", label: "Last 90 days" },
    { id: "all", label: "All time" },
];

export const defaultAnalyticsContext: ProjectAnalyticsContextFilters = {
    memberId: null,
    source: "all",
    dateRange: "30d",
};

export function isAnalyticsContextDefault(context: ProjectAnalyticsContextFilters) {
    return context.memberId === null && context.source === "all" && context.dateRange === "30d";
}

export function analyticsDateRangeStart(range: ProjectAnalyticsContextDateRange) {
    if (range === "all") return null;
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
}

export function isWithinAnalyticsDateRange(value: string | null | undefined, range: ProjectAnalyticsContextDateRange) {
    const start = analyticsDateRangeStart(range);
    if (!start || !value) return true;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return true;
    return date >= start;
}

export function timelineEventMatchesContext(event: ProjectAnalyticsTimelineEvent, context: ProjectAnalyticsContextFilters) {
    if (context.memberId && event.actor?.id !== context.memberId) return false;
    if (context.source && context.source !== "all" && event.sourceSurface !== context.source) return false;
    return isWithinAnalyticsDateRange(event.occurredAt, context.dateRange);
}

export function AnalyticsShellCard({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={`rounded-2xl border border-zinc-200 bg-white/85 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/75 ${className}`}>
            {children}
        </section>
    );
}

export function AnalyticsSectionHeader({
    eyebrow,
    title,
    description,
}: {
    eyebrow?: string;
    title: string;
    description?: string;
}) {
    return (
        <div className="space-y-1">
            {eyebrow ? (
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-500">{eyebrow}</p>
            ) : null}
            <div>
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
                {description ? (
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</p>
                ) : null}
            </div>
        </div>
    );
}

export function AnalyticsMetric({
    label,
    value,
    description,
}: {
    label: string;
    value: string | number;
    description?: string;
}) {
    return (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">{label}</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{value}</p>
            {description ? <p className="mt-1 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">{description}</p> : null}
        </div>
    );
}

export function AnalyticsActionLink({ link }: { link: ProjectAnalyticsActionLink }) {
    return (
        <a
            className="inline-flex items-center rounded-full border border-zinc-200 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:text-blue-300"
            href={link.href}
        >
            {link.label}
        </a>
    );
}

export function AnalyticsContextNote({
    context,
    memberName,
}: {
    context: ProjectAnalyticsContextFilters;
    memberName?: string | null;
}) {
    if (isAnalyticsContextDefault(context)) return null;
    const parts = [
        memberName ? `Member: ${memberName}` : null,
        context.source !== "all" ? `Surface: ${context.source}` : null,
        context.dateRange !== "30d" ? `Window: ${ANALYTICS_DATE_RANGE_OPTIONS.find((option) => option.id === context.dateRange)?.label ?? context.dateRange}` : null,
    ].filter(Boolean);
    if (!parts.length) return null;
    return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
            Focused context: {parts.join(" · ")}
        </div>
    );
}

export function AnalyticsCoverageNote({
    sourceSummary,
}: {
    sourceSummary: ProjectAnalyticsOverview["sourceSummary"];
}) {
    const cappedEntries = Object.entries(sourceSummary.capped ?? {})
        .filter(([, capped]) => capped)
        .map(([key]) => {
            const cap = sourceSummary.caps?.[key as keyof NonNullable<ProjectAnalyticsOverview["sourceSummary"]["caps"]>];
            return cap ? `${key}: latest ${cap}` : key;
        });
    return (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Data coverage</p>
            <p className="mt-1 leading-5">
                {cappedEntries.length
                    ? `Some sources reached their performance caps (${cappedEntries.join(", ")}). Open the source tab for complete raw records.`
                    : "No source reached its performance cap; this view is based on the currently loaded project records."}
            </p>
            {sourceSummary.privateFilesHidden ? (
                <p className="mt-1 leading-5 text-zinc-500">
                    {sourceSummary.privateFilesHidden} private {sourceSummary.privateFilesHidden === 1 ? "file is" : "files are"} hidden from analytics.
                </p>
            ) : null}
        </div>
    );
}

export function AnalyticsPersonAvatar({
    person,
    size = "sm",
}: {
    person: Pick<ProjectAnalyticsPerson, "name" | "avatarUrl">;
    size?: "xs" | "sm" | "md";
}) {
    const sizeClass = size === "md"
        ? "h-10 w-10 rounded-xl text-sm"
        : size === "xs"
            ? "h-5 w-5 rounded-full text-[10px]"
            : "h-9 w-9 rounded-xl text-sm";
    if (person.avatarUrl) {
        return (
            <img
                src={person.avatarUrl}
                alt={`${person.name} profile`}
                className={`${sizeClass} shrink-0 object-cover ring-1 ring-zinc-200 dark:ring-zinc-800`}
                loading="lazy"
            />
        );
    }
    return (
        <div className={`flex ${sizeClass} shrink-0 items-center justify-center bg-blue-100 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200`}>
            {person.name.slice(0, 1).toUpperCase()}
        </div>
    );
}

export function AnalyticsInsightCard({ insight }: { insight: ProjectAnalyticsInsight }) {
    const toneClass = {
        neutral: "border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60",
        success: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-50",
        warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-50",
        danger: "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-50",
    }[insight.tone];
    return (
        <article className={`rounded-xl border p-2.5 ${toneClass}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold">{insight.title}</h4>
                    <p className="mt-1 text-[11px] leading-4 opacity-75">{insight.body}</p>
                </div>
                {typeof insight.metric !== "undefined" ? (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold dark:bg-black/20">{insight.metric}</span>
                ) : null}
            </div>
            <div className="mt-2.5">
                <AnalyticsActionLink link={insight.actionLink} />
            </div>
        </article>
    );
}

export function AnalyticsEmptyState({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="rounded-xl border border-dashed border-zinc-300 p-5 text-center dark:border-zinc-800">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
    );
}

export function AnalyticsLoadingState({ label = "Loading project analytics..." }: { label?: string }) {
    return (
        <AnalyticsShellCard>
            <div className="animate-pulse space-y-3" aria-hidden="true">
                <div className="h-3 w-32 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-7 w-60 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                <div className="grid gap-2 md:grid-cols-3">
                    <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                </div>
            </div>
            <span className="sr-only" role="status" aria-live="polite">{label}</span>
        </AnalyticsShellCard>
    );
}

import { CheckSquare, Timer, FileText, User, UserPlus, Activity, Settings, Info } from "lucide-react";
import { cn } from "@/lib/utils";

function getEventPresentation(type: ProjectAnalyticsTimelineEvent["type"]) {
    switch (type) {
        case "task":
            return { Icon: CheckSquare, colorClass: "text-blue-500" };
        case "sprint":
            return { Icon: Timer, colorClass: "text-indigo-500" };
        case "file":
            return { Icon: FileText, colorClass: "text-emerald-500" };
        case "member":
            return { Icon: User, colorClass: "text-violet-500" };
        case "application":
            return { Icon: UserPlus, colorClass: "text-amber-500" };
        case "workflow":
            return { Icon: Activity, colorClass: "text-rose-500" };
        case "settings":
            return { Icon: Settings, colorClass: "text-zinc-500" };
        default:
            return { Icon: Info, colorClass: "text-zinc-400" };
    }
}

export function TimelineEventRow({ event }: { event: ProjectAnalyticsTimelineEvent }) {
    const occurred = new Date(event.occurredAt);
    const occurredLabel = Number.isNaN(occurred.getTime())
        ? "Unknown time"
        : occurred.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });

    const { Icon, colorClass } = getEventPresentation(event.type);

    return (
        <article className="relative pl-0 py-3 text-xs">
            {/* Centered Node Icon/Avatar */}
            <div className="absolute -left-[38px] top-1.5 z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                {event.actor ? (
                    event.actor.avatarUrl ? (
                        <img
                            src={event.actor.avatarUrl}
                            alt={event.actor.name}
                            className="h-full w-full rounded-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 text-[10px]">
                            {event.actor.name.slice(0, 1).toUpperCase()}
                        </div>
                    )
                ) : (
                    <Icon className={cn("h-3.5 w-3.5", colorClass)} />
                )}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{event.title}</h4>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                        {event.type}
                    </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{event.description}</p>
                {event.representativeNames?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {event.representativeNames.map((name) => (
                            <span key={name} className="max-w-56 truncate rounded-full bg-zinc-50 border border-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900/40 dark:border-zinc-800 dark:text-zinc-400">
                                {name}
                            </span>
                        ))}
                        {event.hiddenCount ? (
                            <span className="rounded-full bg-zinc-50 border border-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 dark:bg-zinc-900/40 dark:border-zinc-800">
                                +{event.hiddenCount} more
                            </span>
                        ) : null}
                    </div>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-450 text-zinc-400 dark:text-zinc-500">
                    <span>{occurredLabel}</span>
                    {event.actor ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-650 text-zinc-500 dark:text-zinc-400">
                            by {event.actor.name}
                        </span>
                    ) : null}
                    <AnalyticsActionLink link={event.actionLink} />
                </div>
            </div>
        </article>
    );
}
