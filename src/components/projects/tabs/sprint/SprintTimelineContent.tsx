"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCode2,
  FileUp,
  Flag,
  FolderOpen,
  Link2,
  Paperclip,
  PlayCircle,
} from "lucide-react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  SPRINT_TASK_STATUS_PRESENTATION,
  formatSprintDateRange,
  formatSprintTimelineStamp,
  pluralizeSprintUnit,
  type SprintDrawerState,
  type SprintTimelineRow,
} from "@/lib/projects/sprint-detail";
import type { SprintTimelineViewModel } from "@/lib/projects/sprint-presentation";
import { cn } from "@/lib/utils";

function toShortName(fullName: string | null | undefined) {
  return fullName?.trim().split(/\s+/)[0] ?? "User";
}

function buildTaskNarrative(
  task: Extract<SprintTimelineRow, { kind: "task" }>["task"],
) {
  if (task.description?.trim()) return task.description.trim();

  const byStatus: Record<typeof task.status, string> = {
    todo: "This work item is queued inside the sprint and ready to move.",
    in_progress: "This work item is active in the sprint flow right now.",
    done: "This work item has been completed inside the sprint.",
    blocked:
      "This work item is blocked and needs intervention before progress can continue.",
  };

  const details: string[] = [];
  if (typeof task.storyPoints === "number") {
    details.push(`${task.storyPoints} pts`);
  }
  if (task.linkedFileCount > 0) {
    details.push(pluralizeSprintUnit(task.linkedFileCount, "linked file"));
  }

  return details.length > 0
    ? `${byStatus[task.status]} ${details.join(" · ")}.`
    : byStatus[task.status];
}

function buildFileNarrative(row: Extract<SprintTimelineRow, { kind: "file" }>) {
  const details: string[] = [];
  if (row.file.annotation?.trim()) {
    details.push(row.file.annotation.trim());
  }
  if (row.file.lastEventType) {
    details.push(
      `Latest file event: ${row.file.lastEventType.replace(/_/g, " ")}`,
    );
  }
  if (details.length > 0) return details.join(" · ");
  return `Linked to ${row.task.taskNumber ? `NB-${row.task.taskNumber}` : row.task.title} as sprint file context.`;
}

function buildFilesWorkspaceHref(
  projectSlug: string,
  nodeId: string,
  path: string | null | undefined,
) {
  const params = new URLSearchParams({ tab: "files", fileId: nodeId });
  if (path?.trim()) {
    params.set("path", path.trim());
  }
  return `/projects/${projectSlug}?${params.toString()}`;
}

function TimelineTag({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 text-zinc-600 dark:text-zinc-300",
        className,
      )}
    >
      {children}
    </span>
  );
}

function TimelineNode({
  className,
  children,
  connectsToNext = false,
}: {
  className?: string;
  children: ReactNode;
  connectsToNext?: boolean;
}) {
  return (
    <span className="absolute left-0 top-0 flex h-full w-7 justify-center">
      {connectsToNext ? (
        <span
          aria-hidden="true"
          className="absolute bottom-[-1.5rem] top-7 w-px bg-zinc-200 dark:bg-zinc-800"
        />
      ) : null}
      <span
        className={cn(
          "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-white text-zinc-600 ring-[3px] ring-white dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-950",
          className,
        )}
      >
        {children}
      </span>
    </span>
  );
}

function KickoffEntry({
  row,
  isLast,
}: {
  row: Extract<SprintTimelineRow, { kind: "kickoff" }>;
  isLast: boolean;
}) {
  const creator = row.sprint.creator;
  const creatorName = creator?.fullName || "A project leader";
  const roleLabel = creator?.roleLabel || "Owner";

  return (
    <div className="relative pl-12">
      <TimelineNode
        connectsToNext={!isLast}
        className="border-indigo-200 text-indigo-600 dark:border-indigo-900/60 dark:text-indigo-300"
      >
        <PlayCircle className="h-4 w-4" />
      </TimelineNode>
      <article className="space-y-3">
        <div className="flex items-center gap-2.5">
          {creator ? (
            <UserAvatar
              identity={creator}
              size={24}
              className="h-6 w-6 shrink-0"
              fallbackClassName="text-[10px]"
            />
          ) : null}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {creatorName}
            </span>
            {roleLabel ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                ({roleLabel})
              </span>
            ) : null}
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              kicked off the sprint
            </span>
          </div>
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500 font-medium">
            {formatSprintTimelineStamp(row.occurredAt)}
          </span>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-900 dark:bg-zinc-900/10 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {row.sprint.name}
            </h4>
            <TimelineTag className="border-indigo-100 bg-indigo-50/30 text-indigo-700 dark:border-indigo-950 dark:bg-indigo-950/20 dark:text-indigo-300">
              {formatSprintDateRange(row.sprint.startDate, row.sprint.endDate)}
            </TimelineTag>
          </div>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            {row.sprint.goal?.trim()
              ? row.sprint.goal
              : "No focal goal set for this sprint focus."}
          </p>
        </div>
      </article>
    </div>
  );
}

function CloseoutEntry({
  row,
}: {
  row: Extract<SprintTimelineRow, { kind: "closeout" }>;
}) {
  const percentComplete = row.summary.totalTasks > 0
    ? Math.round((row.summary.completedTasks / row.summary.totalTasks) * 100)
    : 0;
  const metrics = [
    {
      label: "Delivery",
      value: row.summary.completedTasks,
      total: row.summary.totalTasks,
      caption: "Tasks done",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    {
      label: "Velocity",
      value: row.summary.completedStoryPoints,
      total: row.summary.totalStoryPoints,
      caption: "Points completed",
      icon: <CircleDashed className="h-3.5 w-3.5" />,
    },
    {
      label: "Blockers",
      value: row.summary.blockedTasks,
      caption: "Blocked tasks",
      valueClassName: row.summary.blockedTasks > 0 ? "text-orange-600 dark:text-orange-400" : undefined,
      icon: <Flag className={cn("h-3.5 w-3.5", row.summary.blockedTasks > 0 && "text-orange-500")} />,
    },
    {
      label: "Assets",
      value: row.summary.linkedFileCount,
      caption: "Linked files",
      icon: <Paperclip className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="relative pl-12">
      <TimelineNode className="border-emerald-200 text-emerald-600 dark:border-emerald-950 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
      </TimelineNode>
      <article className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Sprint Dashboard Summary
          </h3>
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500 font-medium">
            {formatSprintTimelineStamp(row.occurredAt)}
          </span>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-5 dark:border-zinc-900 dark:bg-zinc-900/10 space-y-4">
          {row.summary.totalTasks > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-505 text-zinc-500 dark:text-zinc-400">
                <span>PROGRESS</span>
                <span className="text-emerald-600 dark:text-emerald-400">{percentComplete}% Complete</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No tasks have been linked to this sprint yet.</p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-zinc-100 bg-white p-3 dark:border-zinc-900 dark:bg-zinc-950/40">
                <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
                  {metric.icon}
                  <span className="text-[10px] font-semibold uppercase tracking-wider">{metric.label}</span>
                </div>
                <p className={cn("mt-1 text-base font-bold text-zinc-800 dark:text-zinc-200", metric.valueClassName)}>
                  {metric.value}
                  {typeof metric.total === "number" ? (
                    <span className="text-xs font-normal text-zinc-400"> / {metric.total}</span>
                  ) : null}
                </p>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{metric.caption}</span>
              </div>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}

function FileEntry({
  row,
  projectSlug,
  isLast,
}: {
  row: Extract<SprintTimelineRow, { kind: "file" }>;
  projectSlug: string;
  isLast: boolean;
}) {
  const workspaceHref = buildFilesWorkspaceHref(
    projectSlug,
    row.file.nodeId,
    row.file.nodePath,
  );
  return (
    <div className="relative pl-12">
      <TimelineNode
        connectsToNext={!isLast}
        className="border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-300"
      >
        {row.file.nodeType === "folder" ? (
          <FolderOpen className="h-4 w-4" />
        ) : (
          <FileCode2 className="h-4 w-4" />
        )}
      </TimelineNode>
      <article className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-zinc-500">
          {formatSprintTimelineStamp(row.occurredAt)}
        </p>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={workspaceHref}
              className="text-left text-sm font-semibold text-zinc-900 transition-colors hover:text-primary dark:text-zinc-100"
            >
              {row.file.nodeName}
            </Link>
            <TimelineTag>
              <Link2 className="h-3 w-3" />
              Linked file
            </TimelineTag>
            <TimelineTag
              className={
                SPRINT_TASK_STATUS_PRESENTATION[row.task.status].toneClassName
              }
            >
              {row.task.taskNumber
                ? `NB-${row.task.taskNumber}`
                : row.task.title}
            </TimelineTag>
          </div>
          <p className="text-sm leading-5 text-zinc-500 dark:text-zinc-400">
            {buildFileNarrative(row)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={workspaceHref}>
            <TimelineTag className="hover:border-zinc-300 hover:text-zinc-900 dark:hover:border-zinc-700 dark:hover:text-zinc-100">
              <ArrowUpRight className="h-3 w-3" />
              Open in files
            </TimelineTag>
          </Link>
        </div>
      </article>
    </div>
  );
}

function FileVersionEntry({
  row,
  projectSlug,
  isLast,
}: {
  row: Extract<SprintTimelineRow, { kind: "file_version" }>;
  projectSlug: string;
  isLast: boolean;
}) {
  const workspaceHref = buildFilesWorkspaceHref(
    projectSlug,
    row.file.nodeId,
    row.file.nodePath,
  );
  const taskLabel = row.task.taskNumber
    ? `NB-${row.task.taskNumber}`
    : row.task.title;
  const actorName = row.versionEvent.createdByName?.trim() || "A project member";
  return (
    <div className="relative pl-12">
      <TimelineNode
        connectsToNext={!isLast}
        className="border-blue-100 text-blue-600 dark:border-blue-950 dark:text-blue-300"
      >
        <FileUp className="h-3.5 w-3.5" />
      </TimelineNode>
      <article className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
          {formatSprintTimelineStamp(row.occurredAt)}
        </p>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium leading-5 text-zinc-800 dark:text-zinc-200">
              <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                {actorName}
              </span>{" "}
              updated{" "}
              <Link href={workspaceHref} className="font-semibold text-blue-600 hover:underline dark:text-blue-300">
                {row.file.nodeName}
              </Link>{" "}
              to V{row.versionEvent.versionNumber} for {taskLabel}
            </p>
            <TimelineTag className="border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-300">
              Task file update
            </TimelineTag>
          </div>
          {row.versionEvent.comment ? (
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {row.versionEvent.comment}
            </p>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function TaskEntry({
  row,
  onOpenDrawer,
  onPrefetchDrawer,
  isLast,
}: {
  row: Extract<SprintTimelineRow, { kind: "task" }>;
  onOpenDrawer: (drawer: SprintDrawerState) => void;
  onPrefetchDrawer: (drawer: SprintDrawerState) => void;
  isLast: boolean;
}) {
  const reporter = row.task.creator?.fullName
    ? toShortName(row.task.creator.fullName)
    : null;
  const assignee = row.task.assignee?.fullName
    ? toShortName(row.task.assignee.fullName)
    : null;

  return (
    <div className="relative pl-12">
      <TimelineNode
        connectsToNext={!isLast}
        className={cn(
          "border-zinc-200 dark:border-zinc-800",
          SPRINT_TASK_STATUS_PRESENTATION[row.task.status].toneClassName,
        )}
      >
        {row.task.status === "done" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : row.task.status === "in_progress" ? (
          <ArrowUpRight className="h-4 w-4" />
        ) : row.task.status === "blocked" ? (
          <Flag className="h-4 w-4" />
        ) : (
          <CircleDashed className="h-4 w-4" />
        )}
      </TimelineNode>
      <article className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-zinc-500">
          {formatSprintTimelineStamp(row.occurredAt)}
        </p>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenDrawer({ type: "task", id: row.task.id })}
              onMouseEnter={() =>
                onPrefetchDrawer({ type: "task", id: row.task.id })
              }
              onFocus={() =>
                onPrefetchDrawer({ type: "task", id: row.task.id })
              }
              className="text-left text-sm font-semibold text-zinc-900 transition-colors hover:text-primary dark:text-zinc-100"
            >
              {row.task.taskNumber ? `NB-${row.task.taskNumber} · ` : ""}
              {row.task.title}
            </button>
            <TimelineTag
              className={
                SPRINT_TASK_STATUS_PRESENTATION[row.task.status].toneClassName
              }
            >
              {SPRINT_TASK_STATUS_PRESENTATION[row.task.status].label}
            </TimelineTag>
          </div>
          <p className="text-sm leading-5 text-zinc-500 dark:text-zinc-400">
            {buildTaskNarrative(row.task)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.task.creator ? (
            <TimelineTag>
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar
                  identity={row.task.creator}
                  size={16}
                  className="h-4 w-4"
                  fallbackClassName="text-[9px]"
                />
                Reported by {reporter}
              </span>
            </TimelineTag>
          ) : null}
          {row.task.assignee ? (
            <TimelineTag>
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar
                  identity={row.task.assignee}
                  size={16}
                  className="h-4 w-4"
                  fallbackClassName="text-[9px]"
                />
                Assigned to {assignee}
              </span>
            </TimelineTag>
          ) : null}
          {typeof row.task.storyPoints === "number" ? (
            <TimelineTag>
              {pluralizeSprintUnit(row.task.storyPoints, "pt", "pts")}
            </TimelineTag>
          ) : null}
          <TimelineTag>
            <Flag
              className={cn(
                "h-3 w-3",
                row.task.priority === "urgent"
                  ? "text-red-500"
                  : row.task.priority === "high"
                    ? "text-orange-500"
                    : row.task.priority === "medium"
                      ? "text-amber-500"
                      : "text-zinc-400",
              )}
            />
            {row.task.priority}
          </TimelineTag>
          {row.task.linkedFileCount > 0 ? (
            <TimelineTag>
              <Paperclip className="h-3 w-3" />
              {pluralizeSprintUnit(row.task.linkedFileCount, "linked file")}
            </TimelineTag>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function TimelineEmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-8 dark:border-zinc-800 dark:bg-zinc-900/25">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
          <Clock3 className="h-4 w-4" />
        </div>
        <div className="space-y-1 text-left">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            No sprint activity yet
          </h3>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Assign tasks from the Tasks tab to see sprint work unfold here.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChronologicalTimeline({
  rows,
  projectSlug,
  onOpenDrawer,
  onPrefetchDrawer,
  shouldVirtualize,
}: {
  rows: SprintTimelineRow[];
  projectSlug: string;
  onOpenDrawer: (drawer: SprintDrawerState) => void;
  onPrefetchDrawer: (drawer: SprintDrawerState) => void;
  shouldVirtualize: boolean;
}) {
  const renderRow = (row: SprintTimelineRow, index: number) => {
    const isLast = index === rows.length - 1;
    if (row.kind === "kickoff") {
      return <KickoffEntry row={row} isLast={isLast} />;
    }
    if (row.kind === "closeout") {
      return <CloseoutEntry row={row} />;
    }
    if (row.kind === "file") {
      return (
        <FileEntry
          row={row}
          projectSlug={projectSlug}
          isLast={isLast}
        />
      );
    }
    if (row.kind === "file_version") {
      return (
        <FileVersionEntry row={row} projectSlug={projectSlug} isLast={isLast} />
      );
    }
    return (
      <TaskEntry
        row={row}
        onOpenDrawer={onOpenDrawer}
        onPrefetchDrawer={onPrefetchDrawer}
        isLast={isLast}
      />
    );
  };

  if (!shouldVirtualize) {
    return (
      <div className="space-y-6">
        {rows.map((row, index) => (
          <div key={row.id}>{renderRow(row, index)}</div>
        ))}
      </div>
    );
  }

  return (
    <Virtuoso
      style={{ height: Math.min(860, Math.max(520, rows.length * 92)) }}
      data={rows}
      itemContent={(index, row) => (
        <div className="pb-6 pr-2">{renderRow(row, index)}</div>
      )}
    />
  );
}

interface SprintTimelineContentProps {
  viewModel: SprintTimelineViewModel;
  projectSlug: string;
  shouldVirtualize: boolean;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onOpenDrawer: (drawer: SprintDrawerState) => void;
  onPrefetchDrawer: (drawer: SprintDrawerState) => void;
}

export function SprintTimelineContent({
  viewModel,
  projectSlug,
  shouldVirtualize,
  hasMore,
  isFetchingNextPage,
  onLoadMore,
  onOpenDrawer,
  onPrefetchDrawer,
}: SprintTimelineContentProps) {
  const hasContent = viewModel.rows.some(
    (row) =>
      row.kind === "task" ||
      row.kind === "file" ||
      row.kind === "file_version",
  );

  return (
    <div className="space-y-6 px-0 py-6">
      {hasContent ? (
        <ChronologicalTimeline
          rows={viewModel.rows}
          projectSlug={projectSlug}
          onOpenDrawer={onOpenDrawer}
          onPrefetchDrawer={onPrefetchDrawer}
          shouldVirtualize={shouldVirtualize}
        />
      ) : (
        <TimelineEmptyState />
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
          >
            {isFetchingNextPage
              ? "Loading more sprint activity..."
              : "Load more sprint activity"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
