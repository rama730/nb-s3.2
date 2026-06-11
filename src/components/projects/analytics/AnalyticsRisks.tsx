import type { ProjectAnalyticsContextFilters } from "@/lib/projects/analytics";
import { updateProjectAnalyticsRiskLifecycleAction } from "@/app/actions/project";
import { useProjectAnalyticsRisks } from "@/hooks/hub/useProjectAnalyticsData";
import {
    AnalyticsActionLink,
    AnalyticsContextNote,
    AnalyticsEmptyState,
    AnalyticsLoadingState,
    AnalyticsSectionHeader,
    AnalyticsShellCard,
    SeverityPill,
} from "./AnalyticsShared";

const riskSurfaceMatchesSource = (surface: string | undefined, source: ProjectAnalyticsContextFilters["source"]) => {
    if (source === "all") return true;
    const normalized = (surface ?? "").toLowerCase();
    if (source === "tasks") return normalized.includes("task");
    if (source === "files") return normalized.includes("file");
    if (source === "sprints") return normalized.includes("sprint");
    if (source === "members") return normalized.includes("member") || normalized.includes("collaborator");
    if (source === "applications") return normalized.includes("application") || normalized.includes("role");
    if (source === "workflow") return normalized.includes("workflow") || normalized.includes("task");
    if (source === "settings") return normalized.includes("setting") || normalized.includes("access");
    return true;
};

export function AnalyticsRisks({
    projectId,
    context,
    memberName,
}: {
    projectId: string;
    context: ProjectAnalyticsContextFilters;
    memberName?: string | null;
}) {
    const risksQuery = useProjectAnalyticsRisks(projectId, context);
    const updateRiskStatus = async (riskId: string, status: "acknowledged" | "resolved" | "dismissed") => {
        const result = await updateProjectAnalyticsRiskLifecycleAction(projectId, riskId, status);
        if (!result.success) throw new Error(result.error);
        await risksQuery.refetch();
    };
    if (risksQuery.isLoading) return <AnalyticsLoadingState label="Loading risk signals..." />;
    const risks = (risksQuery.data ?? []).filter((risk) => {
        if (context.memberId && risk.owner?.id && risk.owner.id !== context.memberId) return false;
        if (!riskSurfaceMatchesSource(risk.affectedSurface, context.source)) return false;
        return true;
    });
    const high = risks.filter((risk) => risk.severity === "high").length;
    const medium = risks.filter((risk) => risk.severity === "medium").length;
    const low = risks.filter((risk) => risk.severity === "low").length;
    const activeRisks = risks.filter((risk) => risk.lifecycleStatus !== "resolved" && risk.lifecycleStatus !== "dismissed").slice(0, 5);
    const archivedRisks = risks.filter((risk) => risk.lifecycleStatus === "resolved" || risk.lifecycleStatus === "dismissed");

    return (
        <div className="space-y-3">
            <AnalyticsContextNote context={context} memberName={memberName} />
            <AnalyticsShellCard>
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <AnalyticsSectionHeader
                        eyebrow="Risks"
                        title="Support-oriented risk signals"
                        description="Risks are deterministic and collaborative: each one explains why it appeared, what it affects, and where to act."
                    />
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{high} high</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">{medium} medium</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{low} low</span>
                    </div>
                </div>
            </AnalyticsShellCard>

            {activeRisks.length ? (
                <div className="grid gap-2 xl:grid-cols-2">
                    {activeRisks.map((risk) => (
                        <article key={risk.id} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{risk.title}</h3>
                                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold capitalize text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">{risk.lifecycleStatus}</span>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{risk.reason}</p>
                                </div>
                                <SeverityPill severity={risk.severity} />
                            </div>
                            <div className="mt-2.5 grid gap-2 text-xs sm:grid-cols-2">
                                <div className="rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-900/60">
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">Signal</p>
                                    <p className="mt-1 text-zinc-500">{risk.signal ?? risk.severity}</p>
                                </div>
                                <div className="rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-900/60">
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">Lead</p>
                                    <p className="mt-1 text-zinc-500">{risk.owner?.name ?? "Team decision"}</p>
                                </div>
                                <div className="rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-900/60">
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">Affected</p>
                                    <p className="mt-1 text-zinc-500">{risk.affectedItem}</p>
                                </div>
                                <div className="rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-900/60">
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">Surface</p>
                                    <p className="mt-1 text-zinc-500">{risk.affectedSurface ?? "Project"}</p>
                                </div>
                            </div>
                            <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-xs dark:border-blue-900/60 dark:bg-blue-950/30">
                                <p className="font-semibold text-blue-950 dark:text-blue-100">Recommended next step</p>
                                <p className="mt-1 text-blue-800 dark:text-blue-200">{risk.suggestedAction}</p>
                            </div>
                            <div className="mt-3">
                                <AnalyticsActionLink link={risk.actionLink} />
                            </div>
                            <details className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
                                <summary className="cursor-pointer font-semibold text-zinc-800 dark:text-zinc-200">Lifecycle controls</summary>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {(["acknowledged", "resolved", "dismissed"] as const).map((status) => (
                                        <button
                                            key={status}
                                            type="button"
                                            onClick={() => {
                                                void updateRiskStatus(risk.id, status).catch((error) => {
                                                    console.error("[analytics] risk_lifecycle_update_failed", error);
                                                });
                                            }}
                                            className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold capitalize text-zinc-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                                        >
                                            Mark {status}
                                        </button>
                                    ))}
                                </div>
                            </details>
                        </article>
                    ))}
                </div>
            ) : (
                <AnalyticsShellCard>
                    <AnalyticsEmptyState title="No risk signals visible" description="No blocked, stale, overloaded, review, or access-related signals matched the current analytics context." />
                </AnalyticsShellCard>
            )}
            {archivedRisks.length ? (
                <AnalyticsShellCard>
                    <details className="text-xs">
                        <summary className="cursor-pointer font-semibold text-zinc-800 dark:text-zinc-200">
                            {archivedRisks.length} resolved or dismissed {archivedRisks.length === 1 ? "signal" : "signals"}
                        </summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {archivedRisks.slice(0, 4).map((risk) => (
                                <div key={risk.id} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{risk.title}</p>
                                    <p className="mt-1 text-zinc-500">{risk.lifecycleStatus} · {risk.affectedSurface ?? "Project"}</p>
                                </div>
                            ))}
                        </div>
                    </details>
                </AnalyticsShellCard>
            ) : null}
        </div>
    );
}
