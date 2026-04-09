"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ExternalLink, Paperclip, X } from "lucide-react";

import { getProjectTaskDetailAction } from "@/app/actions/project";
import { getNodeActivity, getNodeLinkedTasks, getNodeMetadataBatch } from "@/app/actions/files";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import {
  SPRINT_TASK_STATUS_PRESENTATION,
  type SprintDrawerPreview,
  type SprintDrawerState,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

const DRAWER_WIDTH_CLASS = "lg:w-[24rem] xl:w-[26rem]";

function isValidDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value === "number") return Number.isFinite(new Date(value).getTime());
  if (typeof value === "string" && value.trim() === "") return false;
  return Number.isFinite(Date.parse(String(value)));
}

function formatTimelineStamp(value: string | number | Date | null | undefined) {
  if (!isValidDate(value)) return "Recently";
  const normalizedValue = value instanceof Date ? value : (value as string | number);
  const date = normalizedValue instanceof Date ? normalizedValue : new Date(normalizedValue);
  return `${format(date, "MMM d, yyyy")} · ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
}

function buildFilesWorkspaceHref(projectSlug: string, path: string | null | undefined) {
  const params = new URLSearchParams({ tab: "files" });
  if (path?.trim()) {
    params.set("path", path.trim());
  }
  return `/projects/${projectSlug}?${params.toString()}`;
}

function buildSprintDrawerTaskQueryKey(projectId: string, taskId: string | null) {
  return ["project", projectId, "sprint-drawer-task", taskId] as const;
}

function buildSprintDrawerFileQueryKey(projectId: string, nodeId: string | null) {
  return ["project", projectId, "sprint-drawer-file", nodeId] as const;
}

async function fetchSprintDrawerTask(projectId: string, taskId: string) {
  const result = await getProjectTaskDetailAction(projectId, taskId);
  if (!result.success) throw new Error(result.error);
  return result.task;
}

async function fetchSprintDrawerFile(projectId: string, nodeId: string) {
  const [metadata, activity, linkedTasks] = await Promise.all([
    getNodeMetadataBatch(projectId, [nodeId], { includeBreadcrumbs: true }),
    getNodeActivity(projectId, nodeId, 10),
    getNodeLinkedTasks(projectId, nodeId, 10),
  ]);

  if (!metadata.success) {
    throw new Error(metadata.message);
  }

  const node = metadata.data.nodes[0];
  if (!node) throw new Error("File not found");

  return {
    node,
    breadcrumbs: metadata.data.breadcrumbsByNodeId?.[node.id] ?? [{ id: node.id, name: node.name }],
    activity,
    linkedTasks,
  };
}

export async function prefetchSprintDrawerPayload(
  queryClient: QueryClient,
  projectId: string,
  drawer: SprintDrawerState,
) {
  if (drawer.type === "none") return;

  if (drawer.type === "task") {
    await queryClient.prefetchQuery({
      queryKey: buildSprintDrawerTaskQueryKey(projectId, drawer.id),
      queryFn: () => fetchSprintDrawerTask(projectId, drawer.id),
      staleTime: 60_000,
    });
    return;
  }

  await queryClient.prefetchQuery({
    queryKey: buildSprintDrawerFileQueryKey(projectId, drawer.id),
    queryFn: () => fetchSprintDrawerFile(projectId, drawer.id),
    staleTime: 60_000,
  });
}

interface SprintDetailDrawerProps {
  projectId: string;
  projectSlug: string;
  projectName?: string;
  drawer: SprintDrawerState;
  preview: SprintDrawerPreview | null;
  onClose: () => void;
}

export function SprintDetailDrawer({
  projectId,
  projectSlug,
  projectName,
  drawer,
  preview,
  onClose,
}: SprintDetailDrawerProps) {
  const openedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (drawer.type === "none") {
      openedAtRef.current = null;
      return;
    }
    openedAtRef.current = Date.now();
  }, [drawer]);

  const taskQuery = useQuery({
    queryKey: buildSprintDrawerTaskQueryKey(projectId, drawer.type === "task" ? drawer.id : null),
    queryFn: async () => fetchSprintDrawerTask(projectId, drawer.type === "task" ? drawer.id : ""),
    enabled: drawer.type === "task" && !!drawer.id,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const fileQuery = useQuery({
    queryKey: buildSprintDrawerFileQueryKey(projectId, drawer.type === "file" ? drawer.id : null),
    queryFn: async () => fetchSprintDrawerFile(projectId, drawer.type === "file" ? drawer.id : ""),
    enabled: drawer.type === "file" && !!drawer.id,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!openedAtRef.current || drawer.type === "none") return;

    const isSuccess = drawer.type === "task" ? taskQuery.isSuccess : fileQuery.isSuccess;
    if (!isSuccess) return;

    recordSprintMetric("project.sprint.timeline.drawer_preview_ms", {
      projectId,
      drawerType: drawer.type,
      drawerId: drawer.id,
      durationMs: Date.now() - openedAtRef.current,
    });
    openedAtRef.current = null;
  }, [drawer, fileQuery.isSuccess, projectId, taskQuery.isSuccess]);

  if (drawer.type === "none") return null;

  const isLoading = drawer.type === "task" ? taskQuery.isLoading : fileQuery.isLoading;
  const task = drawer.type === "task" ? taskQuery.data : null;
  const file = drawer.type === "file" ? fileQuery.data : null;
  const fileWorkspaceHref = file
    ? buildFilesWorkspaceHref(projectSlug, file.breadcrumbs.map((crumb) => crumb.name).join("/"))
    : null;
  const taskStatusPresentation =
    drawer.type === "task" && task
      ? SPRINT_TASK_STATUS_PRESENTATION[task.status] ?? {
          toneClassName: "text-zinc-500 dark:text-zinc-400",
          label: task.status || "Unknown",
        }
      : null;

  return (
    <aside
      className={cn(
        "border-t border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/40 lg:border-l lg:border-t-0",
        DRAWER_WIDTH_CLASS,
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {drawer.type === "task" ? "Task detail" : "File detail"}
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {projectName || "Project sprint context"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto app-scroll app-scroll-y app-scroll-gutter">
          {preview ? (
            <div className="border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800/80">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border px-2 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {preview.badgeText}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {formatTimelineStamp(preview.occurredAt)}
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {preview.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{preview.subtitle}</p>
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-4 p-5">
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-6 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-20 w-full animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/60" />
            </div>
          ) : drawer.type === "task" && task ? (
            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-zinc-500">
                    {task.taskNumber && task.project?.key ? `${task.project.key}-${task.taskNumber}` : `#${task.id.slice(0, 8)}`}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 text-[11px] font-medium",
                      taskStatusPresentation?.toneClassName ?? "text-zinc-500 dark:text-zinc-400",
                    )}
                  >
                    {taskStatusPresentation?.label ?? task.status}
                  </span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{task.title}</h3>
                <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {task.description?.trim() || "No additional task description has been written yet."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    Priority
                  </p>
                  <p className="mt-2 text-sm font-medium capitalize text-zinc-900 dark:text-zinc-100">{task.priority}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    Story points
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">{task.storyPoints ?? 0}</p>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">People</p>
                {task.assignee ? (
                  <div className="flex items-center gap-3">
                    <UserAvatar identity={task.assignee} size={28} className="h-7 w-7" fallbackClassName="text-[11px]" />
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{task.assignee.fullName || "Assigned user"}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Assignee</p>
                    </div>
                  </div>
                ) : null}
                {task.creator ? (
                  <div className="flex items-center gap-3">
                    <UserAvatar identity={task.creator} size={28} className="h-7 w-7" fallbackClassName="text-[11px]" />
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{task.creator.fullName || "Reporter"}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Reporter</p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/projects/${projectSlug}/tasks/${task.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open full task
                </Link>
              </div>
            </div>
          ) : drawer.type === "file" && file ? (
            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border px-2 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {file.node.type === "folder" ? "Folder" : "File"}
                  </span>
                  <span className="rounded-full border px-2 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {file.node.mimeType || "Unknown type"}
                  </span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{file.node.name}</h3>
                <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {file.breadcrumbs.map((crumb) => crumb.name).join(" / ")}
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Linked tasks</p>
                {file.linkedTasks.length > 0 ? (
                  file.linkedTasks.map((linkedTask) => (
                    <Link
                      key={linkedTask.id}
                      href={`/projects/${projectSlug}/tasks/${linkedTask.id}`}
                      className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {linkedTask.taskNumber ? `NB-${linkedTask.taskNumber}` : linkedTask.title}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatTimelineStamp(linkedTask.linkedAt)}
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No linked tasks found for this node.</p>
                )}
              </div>

              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Recent file activity</p>
                {file.activity.length > 0 ? (
                  file.activity.map((event) => (
                    <div key={event.id} className="space-y-1 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <p className="text-sm font-medium capitalize text-zinc-900 dark:text-zinc-100">{event.type.replace(/_/g, " ")}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatTimelineStamp(event.at)}
                        {event.by ? ` · ${event.by}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No file activity has been recorded yet.</p>
                )}
              </div>

              {fileWorkspaceHref ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={fileWorkspaceHref}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
                  >
                    <Paperclip className="h-4 w-4" />
                    Open in files
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">Unable to load this sprint detail item.</div>
          )}
        </div>
      </div>
    </aside>
  );
}
