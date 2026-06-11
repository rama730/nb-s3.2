"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProjectAnalyticsTabId } from "@/lib/projects/analytics";
import { useProjectAnalyticsMembers, useProjectAnalyticsOverview } from "@/hooks/hub/useProjectAnalyticsData";
import {
    ANALYTICS_DATE_RANGE_OPTIONS,
    ANALYTICS_TAB_COPY,
    AnalyticsEmptyState,
    AnalyticsLoadingState,
    AnalyticsShellCard,
    defaultAnalyticsContext,
    isAnalyticsContextDefault,
} from "@/components/projects/analytics/AnalyticsShared";

const AnalyticsFiles = dynamic(
    () => import("@/components/projects/analytics/AnalyticsFiles").then((mod) => mod.AnalyticsFiles),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);
const AnalyticsMembers = dynamic(
    () => import("@/components/projects/analytics/AnalyticsMembers").then((mod) => mod.AnalyticsMembers),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);
const AnalyticsOverview = dynamic(
    () => import("@/components/projects/analytics/AnalyticsOverview").then((mod) => mod.AnalyticsOverview),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);
const AnalyticsRisks = dynamic(
    () => import("@/components/projects/analytics/AnalyticsRisks").then((mod) => mod.AnalyticsRisks),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);
const AnalyticsSprints = dynamic(
    () => import("@/components/projects/analytics/AnalyticsSprints").then((mod) => mod.AnalyticsSprints),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);
const AnalyticsTimeline = dynamic(
    () => import("@/components/projects/analytics/AnalyticsTimeline").then((mod) => mod.AnalyticsTimeline),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);
const AnalyticsWorkflow = dynamic(
    () => import("@/components/projects/analytics/AnalyticsWorkflow").then((mod) => mod.AnalyticsWorkflow),
    { loading: () => <AnalyticsLoadingState />, ssr: false },
);

interface AnalyticsTabProps {
    projectId: string;
    project: any;
}

const ANALYTICS_TABS: ProjectAnalyticsTabId[] = [
    "overview",
    "members",
    "workflow",
    "sprints",
    "files",
    "risks",
    "timeline",
];

const SOURCE_FILTERS = [
    { id: "all", label: "All surfaces" },
    { id: "tasks", label: "Tasks" },
    { id: "sprints", label: "Sprints" },
    { id: "files", label: "Files" },
    { id: "members", label: "Members" },
    { id: "applications", label: "Applications" },
    { id: "workflow", label: "Workflow" },
    { id: "settings", label: "Settings" },
] as const;

const isAnalyticsTabId = (value: string | null): value is ProjectAnalyticsTabId =>
    Boolean(value && ANALYTICS_TABS.includes(value as ProjectAnalyticsTabId));

const isAnalyticsSource = (value: string | null): value is typeof defaultAnalyticsContext.source =>
    Boolean(value && SOURCE_FILTERS.some((source) => source.id === value));

const isAnalyticsDateRange = (value: string | null): value is typeof defaultAnalyticsContext.dateRange =>
    Boolean(value && ANALYTICS_DATE_RANGE_OPTIONS.some((range) => range.id === value));

export default function AnalyticsTab({ projectId, project }: AnalyticsTabProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const lastUrlRef = useRef<string | null>(null);
    const initialAnalyticsTab = searchParams.get("analyticsTab");
    const initialSelectedMember = searchParams.get("memberId");
    const initialContextMember = searchParams.get("analyticsMember");
    const initialSource = searchParams.get("analyticsSource");
    const initialDateRange = searchParams.get("analyticsWindow");
    const [activeTab, setActiveTab] = useState<ProjectAnalyticsTabId>(() => {
        return isAnalyticsTabId(initialAnalyticsTab) ? initialAnalyticsTab : "overview";
    });
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(() => initialSelectedMember);
    const [context, setContext] = useState(() => {
        return {
            memberId: initialContextMember,
            source: isAnalyticsSource(initialSource) ? initialSource : defaultAnalyticsContext.source,
            dateRange: isAnalyticsDateRange(initialDateRange) ? initialDateRange : defaultAnalyticsContext.dateRange,
        };
    });
    const [memberFilterOpen, setMemberFilterOpen] = useState(() => Boolean(initialContextMember));
    const overviewQuery = useProjectAnalyticsOverview(projectId, context);
    const membersQuery = useProjectAnalyticsMembers(projectId, null, memberFilterOpen);
    const selectedContextMember = membersQuery.data?.find((member) => member.person.id === context.memberId) ?? null;

    useEffect(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", "analytics");
        params.set("analyticsTab", activeTab);

        if (activeTab === "members" && selectedMemberId) params.set("memberId", selectedMemberId);
        else params.delete("memberId");

        if (context.memberId) params.set("analyticsMember", context.memberId);
        else params.delete("analyticsMember");

        if (context.source !== defaultAnalyticsContext.source) params.set("analyticsSource", context.source);
        else params.delete("analyticsSource");

        if (context.dateRange !== defaultAnalyticsContext.dateRange) params.set("analyticsWindow", context.dateRange);
        else params.delete("analyticsWindow");

        const nextUrl = `${pathname}?${params.toString()}`;
        if (lastUrlRef.current === nextUrl) return;
        lastUrlRef.current = nextUrl;
        router.replace(nextUrl, { scroll: false });
    }, [activeTab, context.dateRange, context.memberId, context.source, pathname, router, searchParams, selectedMemberId]);

    const renderTab = () => {
        if (activeTab === "overview") {
            if (overviewQuery.isLoading) return <AnalyticsLoadingState />;
            if (!overviewQuery.data) {
                return (
                    <AnalyticsShellCard>
                        <AnalyticsEmptyState title="Project intelligence unavailable" description="We could not load the project intelligence overview." />
                    </AnalyticsShellCard>
                );
            }
            return <AnalyticsOverview overview={overviewQuery.data} context={context} memberName={selectedContextMember?.person.name ?? null} />;
        }
        if (activeTab === "members") {
            return (
                <AnalyticsMembers
                    projectId={projectId}
                    context={context}
                    selectedMemberId={selectedMemberId}
                    onSelectMember={setSelectedMemberId}
                    onBack={() => setSelectedMemberId(null)}
                />
            );
        }
        if (activeTab === "workflow") return <AnalyticsWorkflow projectId={projectId} context={context} memberName={selectedContextMember?.person.name ?? null} />;
        if (activeTab === "sprints") return <AnalyticsSprints projectId={projectId} context={context} memberName={selectedContextMember?.person.name ?? null} />;
        if (activeTab === "files") return <AnalyticsFiles projectId={projectId} context={context} memberName={selectedContextMember?.person.name ?? null} />;
        if (activeTab === "risks") return <AnalyticsRisks projectId={projectId} context={context} memberName={selectedContextMember?.person.name ?? null} />;
        return <AnalyticsTimeline projectId={projectId} context={context} onContextChange={setContext} />;
    };

    return (
        <div className="space-y-3">
            <AnalyticsShellCard className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-4xl">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-blue-500">Analytics</p>
                        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Project Intelligence</h2>
                        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                            A quiet read on next moves, support signals, workflow, sprints, files, risks, and recent movement for {project?.title || "this project"}.
                        </p>
                    </div>
                </div>
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                    {ANALYTICS_TABS.map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => {
                                setActiveTab(tab);
                                if (tab !== "members") setSelectedMemberId(null);
                            }}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                activeTab === tab
                                    ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            }`}
                            aria-pressed={activeTab === tab}
                        >
                            {ANALYTICS_TAB_COPY[tab]}
                        </button>
                    ))}
                </div>
                <div className="mt-3 grid gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
                    <label className="space-y-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        <span>Member focus</span>
                        <select
                            value={context.memberId ?? "all"}
                            onFocus={() => setMemberFilterOpen(true)}
                            onPointerDown={() => setMemberFilterOpen(true)}
                            onChange={(event) => setContext((current) => ({
                                ...current,
                                memberId: event.target.value === "all" ? null : event.target.value,
                            }))}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                        >
                            <option value="all">All members</option>
                            {(membersQuery.data ?? []).map((member) => (
                                <option key={member.person.id} value={member.person.id}>{member.person.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        <span>Surface</span>
                        <select
                            value={context.source ?? "all"}
                            onChange={(event) => setContext((current) => ({ ...current, source: event.target.value as typeof context.source }))}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                        >
                            {SOURCE_FILTERS.map((source) => (
                                <option key={source.id} value={source.id}>{source.label}</option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        <span>Window</span>
                        <select
                            value={context.dateRange}
                            onChange={(event) => setContext((current) => ({ ...current, dateRange: event.target.value as typeof context.dateRange }))}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                        >
                            {ANALYTICS_DATE_RANGE_OPTIONS.map((range) => (
                                <option key={range.id} value={range.id}>{range.label}</option>
                            ))}
                        </select>
                    </label>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => setContext(defaultAnalyticsContext)}
                            disabled={isAnalyticsContextDefault(context)}
                            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </AnalyticsShellCard>

            {renderTab()}
        </div>
    );
}
