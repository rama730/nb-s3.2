"use client";

import Link from "next/link";
import React from "react";
import { Virtuoso } from "react-virtuoso";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCode2,
  Flag,
  FolderOpen,
  Link2,
  Paperclip,
  PlayCircle,
} from "lucide-react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  SPRINT_STATUS_PRESENTATION,
  SPRINT_TASK_STATUS_PRESENTATION,
  formatSprintDateRange,
  pluralizeSprintUnit,
  type SprintDrawerState,
  type SprintTimelineRow,
} from "@/lib/projects/sprint-detail";
import type {
  SprintGroupedTimelineItem,
  SprintTimelineViewModel,
} from "@/lib/projects/sprint-presentation";
import { cn } from "@/lib/utils";

function isValidDate(value: string | null | undefined) {
  if (!value) return false;
  return Number.isFinite(Date.parse(value));
}

function formatTimelineStamp(value: string | null | undefined) {
  if (!isValidDate(value)) return "Date not set";
  const date = new Date(value as string);
  return `${format(date, "MMM d, yyyy")} · ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
}

function toShortName(fullName: string | null | undefined) {
  return fullName?.trim().split(/\s+/)[0] ?? "User";
}

function buildTaskNarrative(task: Extract<SprintTimelineRow, { kind: "task" }>["task"]) {
  if (task.description?.trim()) return task.description.trim();

  const byStatus: Record<typeof task.status, string> = {
    todo: "This work item is queued inside the sprint and ready to move.",
    in_progress: "This work item is active in the sprint flow right now.",
    done: "This work item has been completed inside the sprint.",
    blocked: "This work item is blocked and needs intervention before progress can continue.",
  };

  const details: string[] = [];
  if (typeof task.storyPoints === "number") {
    details.push(`${task.storyPoints} pts`);
  }
  if (task.linkedFileCount > 0) {
    details.push(pluralizeSprintUnit(task.linkedFileCount, "linked file"));
  }

  return details.length > 0 ? `${byStatus[task.status]} ${details.join(" · ")}.` : byStatus[task.status];
}

function buildFileNarrative(row: Extract<SprintTimelineRow, { kind: "file" }>) {
  const details: string[] = [];
  if (row.file.annotation?.trim()) {
    details.push(row.file.annotation.trim());
  }
  if (row.file.lastEventType) {
    details.push(`Latest file event: ${row.file.lastEventType.replace(/_/g, " ")}`);
  }
  if (details.length > 0) return details.join(" · ");
  return `Linked to ${row.task.taskNumber ? `NB-${row.task.taskNumber}` : row.task.title} as sprint file context.`;
}

function buildFilesWorkspaceHref(projectSlug: string, path: string | null | undefined) {
  const params = new URLSearchParams({ tab: "files" });
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
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300",
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
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border bg-white text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
        className,
      )}
    >
      {children}
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
  return (
    <div className="relative pl-12">
      {!isLast ? <div className="absolute left-[13px] top-7 bottom-[-2.5rem] w-px bg-zinc-200 dark:bg-zinc-800" /> : null}
      <TimelineNode className="border-indigo-200 text-indigo-600 dark:border-indigo-900/60 dark:text-indigo-300">
        <PlayCircle className="h-4 w-4" />
      </TimelineNode>
      <article className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-zinc-500">{formatTimelineStamp(row.occurredAt)}</p>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sprint kickoff</h3>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {row.sprint.goal?.trim()
              ? row.sprint.goal
              : "The sprint was created and is ready to move from planning into delivery."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TimelineTag className={SPRINT_STATUS_PRESENTATION[row.sprint.status].toneClassName}>
            {SPRINT_STATUS_PRESENTATION[row.sprint.status].label}
          </TimelineTag>
          <TimelineTag>{formatSprintDateRange(row.sprint.startDate, row.sprint.endDate)}</TimelineTag>
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
  const title =
    row.sprint.status === "completed"
      ? "Sprint completed"
      : row.sprint.status === "active"
        ? "Sprint in progress"
        : "Sprint planning window";
  const body =
    row.sprint.status === "completed"
      ? `The sprint closed with ${pluralizeSprintUnit(row.summary.completedTasks, "completed task")} out of ${pluralizeSprintUnit(row.summary.totalTasks, "task")}.`
      : row.sprint.status === "active"
        ? `${pluralizeSprintUnit(row.summary.completedTasks, "task")} finished so far across ${pluralizeSprintUnit(row.summary.totalTasks, "task")} in this sprint.`
        : row.summary.totalTasks > 0
          ? `${pluralizeSprintUnit(row.summary.totalTasks, "task")} ${row.summary.totalTasks === 1 ? "is" : "are"} already linked while planning continues.`
          : "No task activity has been linked to this sprint yet.";

  return (
    <div className="relative pl-12">
      <TimelineNode
        className={cn(
          row.sprint.status === "completed"
            ? "border-emerald-200 text-emerald-600 dark:border-emerald-900/60 dark:text-emerald-300"
            : row.sprint.status === "active"
              ? "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
              : "border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400",
        )}
      >
        {row.sprint.status === "completed" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : row.sprint.status === "active" ? (
          <Clock3 className="h-4 w-4" />
        ) : (
          <CircleDashed className="h-4 w-4" />
        )}
      </TimelineNode>
      <article className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-zinc-500">{formatTimelineStamp(row.occurredAt)}</p>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TimelineTag className={SPRINT_STATUS_PRESENTATION[row.sprint.status].toneClassName}>
            {SPRINT_STATUS_PRESENTATION[row.sprint.status].label}
          </TimelineTag>
          {row.summary.linkedFileCount > 0 ? (
            <TimelineTag>
              <Paperclip className="h-3 w-3" />
              {pluralizeSprintUnit(row.summary.linkedFileCount, "linked file")}
            </TimelineTag>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function FileEntry({
  row,
  projectSlug,
  onOpenDrawer,
  onPrefetchDrawer,
  isLast,
  nested = false,
}: {
  row: Extract<SprintTimelineRow, { kind: "file" }>;
  projectSlug: string;
  onOpenDrawer: (drawer: SprintDrawerState) => void;
  onPrefetchDrawer: (drawer: SprintDrawerState) => void;
  isLast: boolean;
  nested?: boolean;
}) {
  const workspaceHref = buildFilesWorkspaceHref(projectSlug, row.file.nodePath);
  return (
    <div className={cn("relative pl-12", nested ? "ml-3 border-l border-dashed border-zinc-200 pl-9 dark:border-zinc-800" : "")}>
      {!isLast ? <div className="absolute left-[13px] top-7 bottom-[-2.5rem] w-px bg-zinc-200 dark:bg-zinc-800" /> : null}
      <TimelineNode className="border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-300">
        {row.file.nodeType === "folder" ? <FolderOpen className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />}
      </TimelineNode>
      <article className="space-y-3">
        <p className="text-xs font-medium tracking-wide text-zinc-500">{formatTimelineStamp(row.occurredAt)}</p>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenDrawer({ type: "file", id: row.file.nodeId })}
              onMouseEnter={() => onPrefetchDrawer({ type: "file", id: row.file.nodeId })}
              onFocus={() => onPrefetchDrawer({ type: "file", id: row.file.nodeId })}
              className="text-left text-sm font-semibold text-zinc-900 transition-colors hover:text-primary dark:text-zinc-100"
            >
              {row.file.nodeName}
            </button>
            <TimelineTag>
              <Link2 className="h-3 w-3" />
              Linked file
            </TimelineTag>
            <TimelineTag className={SPRINT_TASK_STATUS_PRESENTATION[row.task.status].toneClassName}>
              {row.task.taskNumber ? `NB-${row.task.taskNumber}` : row.task.title}
            </TimelineTag>
          </div>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{buildFileNarrative(row)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TimelineTag>{row.file.nodeType === "folder" ? "Folder" : "File"}</TimelineTag>
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
  const reporter = row.task.creator?.fullName ? toShortName(row.task.creator.fullName) : null;
  const assignee = row.task.assignee?.fullName ? toShortName(row.task.assignee.fullName) : null;

  return (
    <div className="relative pl-12">
      {!isLast ? <div className="absolute left-[13px] top-7 bottom-[-2.5rem] w-px bg-zinc-200 dark:bg-zinc-800" /> : null}
      <TimelineNode className={cn("border-zinc-200 dark:border-zinc-800", SPRINT_TASK_STATUS_PRESENTATION[row.task.status].toneClassName)}>
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
      <article className="space-y-3">
        <p className="text-xs font-medium tracking-wide text-zinc-500">{formatTimelineStamp(row.occurredAt)}</p>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenDrawer({ type: "task", id: row.task.id })}
              onMouseEnter={() => onPrefetchDrawer({ type: "task", id: row.task.id })}
              onFocus={() => onPrefetchDrawer({ type: "task", id: row.task.id })}
              className="text-left text-sm font-semibold text-zinc-900 transition-colors hover:text-primary dark:text-zinc-100"
            >
              {row.task.taskNumber ? `NB-${row.task.taskNumber} · ` : ""}
              {row.task.title}
            </button>
            <TimelineTag className={SPRINT_TASK_STATUS_PRESENTATION[row.task.status].toneClassName}>
              {SPRINT_TASK_STATUS_PRESENTATION[row.task.status].label}
            </TimelineTag>
          </div>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{buildTaskNarrative(row.task)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.task.creator ? (
            <TimelineTag>
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar identity={row.task.creator} size={16} className="h-4 w-4" fallbackClassName="text-[9px]" />
                Reported by {reporter}
              </span>
            </TimelineTag>
          ) : null}
          {row.task.assignee ? (
            <TimelineTag>
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar identity={row.task.assignee} size={16} className="h-4 w-4" fallbackClassName="text-[9px]" />
                Assigned to {assignee}
              </span>
            </TimelineTag>
          ) : null}
          {typeof row.task.storyPoints === "number" ? (
            <TimelineTag>{pluralizeSprintUnit(row.task.storyPoints, "pt", "pts")}</TimelineTag>
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

function TimelineEmptyState({
  mode,
}: {
  mode: SprintTimelineViewModel["mode"];
}) {
  const body =
    mode === "files"
      ? "Link sprint files from the files workspace or task attachments to create a file narrative here."
      : mode === "grouped"
        ? "Add work items to this sprint to build grouped task context."
        : "Assign tasks from the Tasks tab to see sprint work unfold here.";

  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-8 dark:border-zinc-800 dark:bg-zinc-900/25">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
          <Clock3 className="h-4 w-4" />
        </div>
        <div className="space-y-1 text-left">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No sprint activity yet</h3>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{body}</p>
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
          onOpenDrawer={onOpenDrawer}
          onPrefetchDrawer={onPrefetchDrawer}
          isLast={isLast}
        />
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
    return <div className="space-y-10">{rows.map((row, index) => <div key={row.id}>{renderRow(row, index)}</div>)}</div>;
  }

  return (
    <Virtuoso
      style={{ height: Math.min(860, Math.max(520, rows.length * 92)) }}
      data={rows}
      itemContent={(index, row) => (
        <div className="pb-10 pr-2">
          {renderRow(row, index)}
        </div>
      )}
    />
  );
}

function GroupedTimeline({
  groups,
  kickoff,
  closeout,
  projectSlug,
  onOpenDrawer,
  onPrefetchDrawer,
}: {
  groups: SprintGroupedTimelineItem[];
  kickoff: Extract<SprintTimelineRow, { kind: "kickoff" }> | null;
  closeout: Extract<SprintTimelineRow, { kind: "closeout" }> | null;
  projectSlug: string;
  onOpenDrawer: (drawer: SprintDrawerState) => void;
  onPrefetchDrawer: (drawer: SprintDrawerState) => void;
}) {
  return (
    <div className="space-y-10">
      {kickoff ? <KickoffEntry row={kickoff} isLast={groups.length === 0 && !closeout} /> : null}
      {groups.map((group, index) => {
        const isLastTask = index === groups.length - 1 && !closeout;
        return (
          <div key={group.taskRow.id} className="space-y-5">
            <TaskEntry
              row={group.taskRow}
              onOpenDrawer={onOpenDrawer}
              onPrefetchDrawer={onPrefetchDrawer}
              isLast={isLastTask && group.fileRows.length === 0}
            />
            {group.fileRows.length > 0 ? (
              <div className="space-y-6">
                {group.fileRows.map((fileRow, fileIndex) => (
                  <FileEntry
                    key={fileRow.id}
                    row={fileRow}
                    projectSlug={projectSlug}
                    onOpenDrawer={onOpenDrawer}
                    onPrefetchDrawer={onPrefetchDrawer}
                    isLast={index === groups.length - 1 && fileIndex === group.fileRows.length - 1 && !closeout}
                    nested
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {closeout ? <CloseoutEntry row={closeout} /> : null}
    </div>
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
  const hasContent =
    viewModel.mode === "grouped"
      ? viewModel.groups.length > 0
      : viewModel.rows.some((row) => row.kind === "task" || row.kind === "file");

  return (
    <div className="space-y-8 px-8 py-7">
      {hasContent ? (
        viewModel.mode === "grouped" ? (
          <GroupedTimeline
            groups={viewModel.groups}
            kickoff={viewModel.kickoff}
            closeout={viewModel.closeout}
            projectSlug={projectSlug}
            onOpenDrawer={onOpenDrawer}
            onPrefetchDrawer={onPrefetchDrawer}
          />
        ) : (
          <ChronologicalTimeline
            rows={viewModel.rows}
            projectSlug={projectSlug}
            onOpenDrawer={onOpenDrawer}
            onPrefetchDrawer={onPrefetchDrawer}
            shouldVirtualize={shouldVirtualize}
          />
        )
      ) : (
        <TimelineEmptyState mode={viewModel.mode} />
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
          >
            {isFetchingNextPage ? "Loading more sprint activity..." : "Load more sprint activity"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
