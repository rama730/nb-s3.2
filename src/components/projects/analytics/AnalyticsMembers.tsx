import type { ProjectAnalyticsContextFilters } from "@/lib/projects/analytics";
import { useProjectAnalyticsMembers, useProjectMemberAnalytics } from "@/hooks/hub/useProjectAnalyticsData";
import { useMemo } from "react";
import { AnalyticsMemberDetail } from "./AnalyticsMemberDetail";
import {
    AnalyticsContextNote,
    AnalyticsEmptyState,
    AnalyticsLoadingState,
    AnalyticsMetric,
    AnalyticsPersonAvatar,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
} from "./AnalyticsShared";

export function AnalyticsMembers({
    projectId,
    context,
    selectedMemberId,
    onSelectMember,
    onBack,
}: {
    projectId: string;
    context: ProjectAnalyticsContextFilters;
    selectedMemberId: string | null;
    onSelectMember: (memberId: string) => void;
    onBack: () => void;
}) {
    const membersQuery = useProjectAnalyticsMembers(projectId, context);
    const resolvedMemberId = useMemo(() => {
        if (!selectedMemberId) return null;
        const found = membersQuery.data?.find(
            (member) => member.person.username === selectedMemberId || member.person.id === selectedMemberId,
        );
        return found?.person.id ?? selectedMemberId;
    }, [membersQuery.data, selectedMemberId]);
    const detailQuery = useProjectMemberAnalytics(projectId, resolvedMemberId, Boolean(selectedMemberId) && !membersQuery.isLoading, context);

    if (selectedMemberId) {
        if (detailQuery.isLoading) return <AnalyticsLoadingState label="Loading member intelligence..." />;
        if (detailQuery.data) return <AnalyticsMemberDetail detail={detailQuery.data} context={context} onBack={onBack} />;
        return (
            <AnalyticsShellCard>
                <AnalyticsEmptyState title="Member detail unavailable" description="This member detail could not be loaded or is not visible for your access level." />
            </AnalyticsShellCard>
        );
    }

    if (membersQuery.isLoading) return <AnalyticsLoadingState label="Loading member contributions..." />;

    const members = membersQuery.data ?? [];
    const visibleMembers = context.memberId ? members.filter((member) => member.person.id === context.memberId) : members;
    const contextMemberName = members.find((member) => member.person.id === context.memberId)?.person.name ?? null;
    const active = visibleMembers.reduce((sum, member) => sum + member.activeTasks, 0);
    const completed = visibleMembers.reduce((sum, member) => sum + member.completedTasks, 0);
    const blocked = visibleMembers.reduce((sum, member) => sum + member.blockedTasks, 0);

    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={contextMemberName} />
            <AnalyticsShellCard>
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <AnalyticsSectionHeader
                        eyebrow="Member Contributions"
                        title="Contribution and support map"
                        description="Compact cards show responsibility, file participation, and support signals without turning this into a leaderboard."
                    />
                    <p className="text-[11px] text-zinc-500">Select a member to open their work story.</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <AnalyticsMetric label="Active" value={active} />
                    <AnalyticsMetric label="Completed" value={completed} />
                    <AnalyticsMetric label="Blocked" value={blocked} />
                </div>
            </AnalyticsShellCard>

            {visibleMembers.length ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {visibleMembers.map((member) => (
                        <button
                            key={member.person.id}
                            type="button"
                            onClick={() => onSelectMember(member.person.username || member.person.id)}
                            className="rounded-xl border border-zinc-200 bg-white p-2.5 text-left transition hover:border-blue-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500"
                        >
                            <div className="flex items-center gap-2.5">
                                <AnalyticsPersonAvatar person={member.person} size="xs" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <h4 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{member.person.name}</h4>
                                    </div>
                                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                                        {member.person.username ? `@${member.person.username}` : member.person.state === "former" ? "Former collaborator" : "Active collaborator"}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px] text-zinc-600 dark:text-zinc-300">
                                <span className="rounded-lg bg-zinc-100 px-1.5 py-1 dark:bg-zinc-900"><strong className="text-zinc-950 dark:text-zinc-50">{member.activeTasks}</strong> active</span>
                                <span className="rounded-lg bg-zinc-100 px-1.5 py-1 dark:bg-zinc-900"><strong className="text-zinc-950 dark:text-zinc-50">{member.completedTasks}</strong> done</span>
                                <span className="rounded-lg bg-zinc-100 px-1.5 py-1 dark:bg-zinc-900"><strong className="text-zinc-950 dark:text-zinc-50">{member.fileContributions}</strong> files</span>
                            </div>
                            {member.blockedTasks > 0 || member.staleTasks > 0 || member.reviewResponsibilities > 0 ? (
                                <div className="mt-2 flex min-h-5 flex-wrap gap-1.5 text-[11px]">
                                    {member.blockedTasks > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">{member.blockedTasks} blocked</span> : member.staleTasks > 0 ? <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700 dark:bg-orange-950/50 dark:text-orange-200">{member.staleTasks} stale</span> : <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">{member.reviewResponsibilities} reviews</span>}
                                </div>
                            ) : null}
                            {member.supportSignals.length ? (
                                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                                    {member.supportSignals.length} support {member.supportSignals.length === 1 ? "signal" : "signals"}
                                </div>
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : (
                <AnalyticsShellCard>
                    <AnalyticsEmptyState title="No member analytics visible" description="No member contribution matched the current analytics context." />
                </AnalyticsShellCard>
            )}
        </div>
    );
}
