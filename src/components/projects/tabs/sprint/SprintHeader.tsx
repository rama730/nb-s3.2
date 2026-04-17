"use client";

import Link from "next/link";
import React from "react";
import { CheckCircle2, ChevronDown, Pencil, PlayCircle } from "lucide-react";

import {
  formatSprintDateRange,
  pluralizeSprintUnit,
  SPRINT_STATUS_PRESENTATION,
  type SprintCompareMetric,
  type SprintCompareSummary,
  type SprintHealthSummary,
  type SprintListItem,
  type SprintPermissionSet,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

function SprintHealthStrip({ summary }: { summary: SprintHealthSummary }) {
  const items = [
    { label: "Completion", value: `${summary.completionPercentage}%` },
    { label: "Completed", value: `${summary.completedTasks}/${summary.totalTasks}` },
    { label: "Blocked", value: String(summary.blockedTasks) },
    { label: "Files", value: String(summary.linkedFileCount) },
    {
      label: "Story points",
      value: summary.totalStoryPoints > 0 ? `${summary.completedStoryPoints}/${summary.totalStoryPoints}` : "0",
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        Sprint progress
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/80"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {item.label}
            </p>
            <p className="mt-1 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCompareDelta(metric: SprintCompareMetric, suffix: string) {
  if (metric.delta === null) return "Baseline";
  if (metric.delta === 0) return "No change";
  return `${metric.delta > 0 ? "+" : ""}${metric.delta}${suffix}`;
}

function ComparePill({
  label,
  metric,
  suffix,
}: {
  label: string;
  metric: SprintCompareMetric;
  suffix: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
        metric.isPositive === null
          ? "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
          : metric.isPositive
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300",
      )}
    >
      <span>{label}</span>
      <span>{formatCompareDelta(metric, suffix)}</span>
    </div>
  );
}

function SprintComparePanel({ compareSummary }: { compareSummary: SprintCompareSummary }) {
  if (compareSummary.baselineKind !== "previous_sprint") {
    return (
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          First sprint baseline
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          This sprint sets the first baseline for the project. Future sprints will compare against it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          Sprint compare
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Compared with{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {compareSummary.baselineSprintName || "previous sprint"}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ComparePill label="Completion" metric={compareSummary.completionRate} suffix="%" />
        <ComparePill label="Blocked" metric={compareSummary.blockedTasks} suffix="" />
        <ComparePill label="Files" metric={compareSummary.linkedFiles} suffix="" />
        <ComparePill label="Done points" metric={compareSummary.completedStoryPoints} suffix="" />
      </div>
    </div>
  );
}

function SprintActivityPanel({
  summary,
  projectSlug,
}: {
  summary: SprintHealthSummary;
  projectSlug: string;
}) {
  const hasActivity = summary.totalTasks > 0 || summary.linkedFileCount > 0;
  const primaryHref = `/projects/${projectSlug}?tab=tasks`;
  const filesHref = `/projects/${projectSlug}?tab=files`;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          Sprint activity
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {hasActivity
            ? `${pluralizeSprintUnit(summary.totalTasks, "work item")} and ${pluralizeSprintUnit(summary.linkedFileCount, "linked file")} are shaping this sprint story.`
            : "No sprint activity yet. Add work items or link files when you are ready to start the sprint story."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SprintActionButton href={primaryHref}>{summary.totalTasks > 0 ? "Open work items" : "Add to work items"}</SprintActionButton>
        <SprintActionButton href={filesHref}>{summary.linkedFileCount > 0 ? "Open linked files" : "Open files"}</SprintActionButton>
      </div>
    </div>
  );
}

function SprintOverviewButton({
  label,
  value,
  detail,
  isActive,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      aria-expanded={isActive}
      onClick={onClick}
      className={cn(
        "group inline-flex min-w-[220px] flex-1 items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
        isActive
          ? "border-zinc-300 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100",
      )}
    >
      <span className="min-w-0 space-y-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <span className="block text-sm font-semibold tracking-tight">{value}</span>
        <span className="block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{detail}</span>
      </span>
      <ChevronDown
        className={cn(
          "mt-1 h-4 w-4 flex-shrink-0 text-zinc-400 transition-transform",
          isActive ? "rotate-180" : "rotate-0",
        )}
      />
    </button>
  );
}

function SprintOverviewPanel({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid transition-all duration-200 ease-out",
        isOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        <div
          aria-hidden={!isOpen}
          className="rounded-2xl border border-zinc-200/80 bg-zinc-50/75 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/45"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SprintMetaTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
      {children}
    </span>
  );
}

function SprintStatusPill({ sprint }: { sprint: SprintListItem }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        SPRINT_STATUS_PRESENTATION[sprint.status].toneClassName,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", SPRINT_STATUS_PRESENTATION[sprint.status].dotClassName)} />
      {SPRINT_STATUS_PRESENTATION[sprint.status].label}
    </span>
  );
}

function SprintActionButton({
  children,
  disabled = false,
  href,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors dark:border-zinc-800 dark:text-zinc-300",
    disabled
      ? "pointer-events-none opacity-60"
      : "hover:border-zinc-300 hover:text-zinc-900 dark:hover:border-zinc-700 dark:hover:text-zinc-100",
  );

  if (href) {
    if (disabled) {
      return (
        <span aria-disabled="true" className={className}>
          {children}
        </span>
      );
    }

    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  );
}

interface SprintHeaderProps {
  sprint: SprintListItem;
  summary: SprintHealthSummary | null;
  compareSummary: SprintCompareSummary | null;
  permissions: SprintPermissionSet;
  isMutatingLifecycle: boolean;
  projectSlug: string;
  onEdit: () => void;
  onStart: () => void;
  onComplete: () => void;
}

type SprintHeaderPanel = "progress" | "activity" | "compare" | null;

export function SprintHeader({
  sprint,
  summary,
  compareSummary,
  permissions,
  isMutatingLifecycle,
  projectSlug,
  onEdit,
  onStart,
  onComplete,
}: SprintHeaderProps) {
  const [activePanel, setActivePanel] = React.useState<SprintHeaderPanel>(null);

  React.useEffect(() => {
    setActivePanel(null);
  }, [sprint.id]);

  const activityDetail =
    summary && (summary.totalTasks > 0 || summary.linkedFileCount > 0)
      ? `${pluralizeSprintUnit(summary.totalTasks, "work item")} · ${pluralizeSprintUnit(summary.linkedFileCount, "linked file")}`
      : "No sprint activity yet";
  const compareDetail =
    compareSummary?.baselineKind === "previous_sprint"
      ? `vs ${compareSummary.baselineSprintName || "previous sprint"}`
      : "First sprint baseline";

  return (
    <header className="border-b border-zinc-200 px-8 py-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{sprint.name}</h2>
            <SprintStatusPill sprint={sprint} />
          </div>
          <p className="max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {sprint.goal?.trim() || "No sprint goal has been written yet."}
          </p>
          {sprint.description?.trim() ? (
            <p className="max-w-3xl text-sm leading-6 text-zinc-400 dark:text-zinc-500">{sprint.description.trim()}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <SprintMetaTag>{formatSprintDateRange(sprint.startDate, sprint.endDate)}</SprintMetaTag>
            {summary ? <SprintMetaTag>{pluralizeSprintUnit(summary.totalTasks, "work item")}</SprintMetaTag> : null}
            {summary ? <SprintMetaTag>{pluralizeSprintUnit(summary.linkedFileCount, "linked file")}</SprintMetaTag> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {permissions.canWrite ? (
            <SprintActionButton disabled={isMutatingLifecycle} onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit Sprint
            </SprintActionButton>
          ) : null}
          {permissions.canStart && sprint.status === "planning" ? (
            <SprintActionButton disabled={isMutatingLifecycle} onClick={onStart}>
              <PlayCircle className="h-4 w-4" />
              Start Sprint
            </SprintActionButton>
          ) : null}
          {permissions.canComplete && sprint.status === "active" ? (
            <SprintActionButton disabled={isMutatingLifecycle} onClick={onComplete}>
              <CheckCircle2 className="h-4 w-4" />
              Complete Sprint
            </SprintActionButton>
          ) : null}
        </div>
      </div>

      {summary ? (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            <SprintOverviewButton
              label="Progress"
              value={`${summary.completionPercentage}% complete`}
              detail={`${summary.completedTasks}/${summary.totalTasks} done · ${summary.blockedTasks} blocked`}
              isActive={activePanel === "progress"}
              onClick={() => setActivePanel((current) => (current === "progress" ? null : "progress"))}
            />
            <SprintOverviewButton
              label="Activity"
              value={summary.totalTasks > 0 || summary.linkedFileCount > 0 ? "Sprint story active" : "No activity yet"}
              detail={activityDetail}
              isActive={activePanel === "activity"}
              onClick={() => setActivePanel((current) => (current === "activity" ? null : "activity"))}
            />
            <SprintOverviewButton
              label="Baseline"
              value={compareSummary?.baselineKind === "previous_sprint" ? "Compare to previous" : "Project baseline"}
              detail={compareSummary ? compareDetail : "Comparison unavailable"}
              isActive={activePanel === "compare"}
              onClick={() => setActivePanel((current) => (current === "compare" ? null : "compare"))}
            />
          </div>

          <SprintOverviewPanel isOpen={activePanel === "progress"}>
            <SprintHealthStrip summary={summary} />
          </SprintOverviewPanel>

          <SprintOverviewPanel isOpen={activePanel === "activity"}>
            <SprintActivityPanel summary={summary} projectSlug={projectSlug} />
          </SprintOverviewPanel>

          <SprintOverviewPanel isOpen={activePanel === "compare"}>
            {compareSummary ? (
              <SprintComparePanel compareSummary={compareSummary} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Sprint comparison is not available for this sprint yet.
              </p>
            )}
          </SprintOverviewPanel>
        </div>
      ) : null}
    </header>
  );
}
