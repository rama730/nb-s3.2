"use client";

import Link from "next/link";
import React from "react";
import { ArrowUpRight, CheckCircle2, PlayCircle } from "lucide-react";

import {
  buildProjectSprintDetailHref,
  formatSprintDateRange,
  pluralizeSprintUnit,
  SPRINT_STATUS_PRESENTATION,
  type SprintCompareMetric,
  type SprintCompareSummary,
  type SprintHealthSummary,
  type SprintListItem,
  type SprintPermissionSet,
  type SprintTimelineFilter,
  type SprintTimelineMode,
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
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/55">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {item.label}
            </p>
            <p className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{item.value}</p>
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

function SprintCompareStrip({ compareSummary }: { compareSummary: SprintCompareSummary }) {
  if (compareSummary.baselineKind !== "previous_sprint") {
    return (
      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/45">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          This sprint sets the first baseline for the project. Future sprints will compare against it.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/45">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Compared with{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {compareSummary.baselineSprintName || "previous sprint"}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <ComparePill label="Completion" metric={compareSummary.completionRate} suffix="%" />
          <ComparePill label="Blocked" metric={compareSummary.blockedTasks} suffix="" />
          <ComparePill label="Files" metric={compareSummary.linkedFiles} suffix="" />
          <ComparePill label="Done points" metric={compareSummary.completedStoryPoints} suffix="" />
        </div>
      </div>
    </div>
  );
}

function SprintActivityNotice({ summary }: { summary: SprintHealthSummary }) {
  if (summary.totalTasks > 0 || summary.linkedFileCount > 0) return null;

  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/35">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No sprint activity yet. Add work items or link files to start the sprint story.
      </p>
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
  filter: SprintTimelineFilter;
  mode: SprintTimelineMode;
  onStart: () => void;
  onComplete: () => void;
}

export function SprintHeader({
  sprint,
  summary,
  compareSummary,
  permissions,
  isMutatingLifecycle,
  projectSlug,
  filter,
  mode,
  onStart,
  onComplete,
}: SprintHeaderProps) {
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
          <div className="flex flex-wrap gap-2">
            <SprintMetaTag>{formatSprintDateRange(sprint.startDate, sprint.endDate)}</SprintMetaTag>
            {summary ? <SprintMetaTag>{pluralizeSprintUnit(summary.totalTasks, "work item")}</SprintMetaTag> : null}
            {summary ? <SprintMetaTag>{pluralizeSprintUnit(summary.linkedFileCount, "linked file")}</SprintMetaTag> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SprintActionButton href={buildProjectSprintDetailHref(projectSlug, sprint.id, { filter, mode })}>
            <ArrowUpRight className="h-4 w-4" />
            Deep link
          </SprintActionButton>
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
        <div className="mt-5 space-y-3">
          <SprintHealthStrip summary={summary} />
          <SprintActivityNotice summary={summary} />
          {compareSummary ? <SprintCompareStrip compareSummary={compareSummary} /> : null}
        </div>
      ) : null}
    </header>
  );
}
