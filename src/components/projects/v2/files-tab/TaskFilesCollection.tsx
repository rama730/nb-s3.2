"use client";

import React, { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderOpen, Loader2, Filter } from "lucide-react";
import { unlinkNodeFromTask } from "@/app/actions/files/links";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { FolderListRowNode } from "./folder/FolderListRow";
import { toast } from "sonner";
import {
  getTaskFileGroups,
  type TaskCollectionEntry,
  type TaskFileGroup,
} from "@/app/actions/files/collections";
import { FolderListView } from "./folder/FolderListView";
import { FilesWorkspaceMenu } from "./FilesWorkspaceHeader";
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { taskFilesHref } from "@/lib/files/task-navigation";
import { useFilesWorkspaceView } from "./FilesWorkspaceViews";
import { formatRelativeTime } from "./folder/format";

function deliverableReviewLabel(
  entry: TaskCollectionEntry,
  reviewStatus: TaskFileGroup["reviewStatus"],
) {
  const currentVersion = entry.node.currentVersion;
  const taskReview = reviewStatus === "pending" ? " · Task review pending" : reviewStatus === "rejected" ? " · Task changes requested" : "";
  if (entry.isCurrentRevisionApproved)
    return `Approved · version ${currentVersion}${taskReview}`;
  if (entry.approvedVersion)
    return `Current content awaiting review · previously approved version ${entry.approvedVersion}${taskReview}`;
  return `Review not recorded${taskReview}`;
}

export function TaskFilesCollection({ projectId }: { projectId: string }) {
  const workspace = useFilesWorkspaceView()!;
  const { taskId, query, view, selectTask } = workspace;
  const search = query;
  const role = workspace.fileRole;
  const setRole = workspace.setFileRole;
  const { canEdit, canManageFiles } = useFilesTabRole();
  const [unlinkTarget, setUnlinkTarget] = useState<FolderListRowNode | null>(
    null,
  );
  const [unlinking, setUnlinking] = useState(false);
  const queryClient = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: ["files-task-collections", projectId, view, taskId, search, role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getTaskFileGroups(projectId, {
        deliverables: view === "deliverables",
        cursor: taskId ? undefined : pageParam,
        fileCursor: taskId ? pageParam : undefined,
        taskId: taskId ?? undefined,
        query: search,
        role: role === "all" ? undefined : role,
      }),
    initialData: () => {
      if (!taskId || search || role !== "all") return undefined;
      const cached = queryClient.getQueriesData<{
        pages: Array<{ groups: TaskFileGroup[] }>;
      }>({ queryKey: ["files-task-collections", projectId, view] });
      const group = cached
        // A group found through task/filename search already contains its
        // first file page. Reuse it while the direct task query revalidates.
        .filter(([key]) => !key[3] && key[5] === "all")
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.groups) ?? [])
        .find((group) => group.id === taskId);
      return group
        ? {
            pages: [{ groups: [group], nextCursor: null }],
            pageParams: [undefined],
          }
        : undefined;
    },
    initialDataUpdatedAt: 0,
    getNextPageParam: (page) => (taskId ? page.groups[0]?.nextFileCursor : page.nextCursor) ?? undefined,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const groups = Array.from(new Map(result.data?.pages.flatMap(page => page.groups).map(group => [group.id, group]) ?? []).values());
  const selected = groups.find((group) => group.id === taskId);
  const setTaskTitle = workspace.setTaskTitle;
  useEffect(() => { if (selected?.title) setTaskTitle(selected.title); }, [selected?.title, setTaskTitle]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if (
        (event as CustomEvent<{ projectId?: string }>).detail?.projectId !==
        projectId
      )
        return;
      void queryClient.invalidateQueries({
        queryKey: ["files-task-collections", projectId],
      });
    };
    window.addEventListener("project:task-files-changed", refresh);
    return () =>
      window.removeEventListener("project:task-files-changed", refresh);
  }, [projectId, queryClient]);
  // ponytail: first and subsequent pages share React Query's cache and retry
  // lifecycle. Deduplicate by identity when concurrent updates overlap pages.
  const visibleEntries = Array.from(new Map(
    result.data?.pages.flatMap(page => page.groups.filter(group => group.id === taskId).flatMap(group => group.entries)).map(entry => [entry.node.id, entry]) ?? [],
  ).values());
  const groupScrollRef = useRef<HTMLElement>(null);
  const groupScrollKey = `${view}:groups:${query}`;
  React.useLayoutEffect(() => {
    if (!taskId && groupScrollRef.current)
      groupScrollRef.current.scrollTop =
        workspace.scrollOffsets.current.get(groupScrollKey) ?? 0;
  }, [taskId, groupScrollKey, result.isPending, workspace.scrollOffsets]);
  const initialLoading =
    query !== search ||
    result.isPending ||
    (taskId && !selected && (result.hasNextPage || result.isFetching));
  const taskMenuItems = taskId ? <>
    {view !== "deliverables" && <DropdownMenuSub><DropdownMenuSubTrigger><Filter className="size-4" />File role</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuRadioGroup aria-label="File role" value={role} onValueChange={value => setRole(value as "all" | "reference" | "working")}>
      <DropdownMenuRadioItem value="all">All files</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="reference">References</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="working">Working files</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>}
    <DropdownMenuItem asChild><a href={`?tab=tasks&drawerType=task&drawerId=${taskId}&panelTab=files`} onClick={event => { event.currentTarget.href = taskFilesHref(window.location.search, taskId!); }}><ArrowRight className="size-4" />Open task files…</a></DropdownMenuItem>
  </> : null;
  return (
    <section
      ref={groupScrollRef}
      onScroll={(event) => {
        if (!taskId && !result.isPending)
          workspace.scrollOffsets.current.set(
            groupScrollKey,
            event.currentTarget.scrollTop,
          );
      }}
      aria-label={view === "deliverables" ? "Deliverables" : "Task files"}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto"
    >
      {(!selected || initialLoading) && <FilesWorkspaceMenu projectId={projectId}>{taskMenuItems}</FilesWorkspaceMenu>}
      {result.isError && (
        <div
          role="alert"
          className="mb-4 rounded border border-red-300 p-3 text-sm"
        >
          {result.error.message}{" "}
          <button onClick={() => void result.refetch()} className="underline">
            Retry
          </button>
        </div>
      )}
      {initialLoading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading task files…
        </div>
      ) : result.isError && !result.data ? null : taskId ? (
        selected ? (
          <>
            <div className="min-h-0 flex-1">
              <FolderListView
                projectId={projectId}
                folderId={null}
                canEdit={canEdit}
                canManageFiles={canManageFiles}
                collection={{
                  preserveOrder: true,
                  menuItems: taskMenuItems,
                  onUnlink: canEdit ? setUnlinkTarget : undefined,
                  nodes: visibleEntries.map((entry) => entry.node),
                  labels: Object.fromEntries(
                    visibleEntries.map((entry) => [
                      entry.node.id,
                      view === "deliverables"
                        ? `Deliverable · ${deliverableReviewLabel(entry, selected.reviewStatus)}`
                        : entry.role === "reference"
                          ? "Reference"
                          : "Working file",
                    ]),
                  ),
                  emptyMessage: "No files match these filters.",
                  footer: result.hasNextPage ? (
                    <button
                      type="button"
                      disabled={result.isFetchingNextPage}
                      onClick={() => void result.fetchNextPage()}
                      className="m-3 min-h-10 rounded border px-4"
                    >
                      {result.isFetchingNextPage ? "Loading…" : "Load more files"}
                    </button>
                  ) : undefined,
                }}
              />
            </div>
          </>
        ) : (
          <p className="py-8 text-sm text-zinc-500">
            {search || role !== "all"
              ? "No files match these filters. Clear the search or choose All files."
              : "This task has no accessible files in this collection. It may have been removed or its file roles changed."}
          </p>
        )
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => selectTask(group.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-900"
                >
                  <FolderOpen className="h-5 w-5 shrink-0 text-blue-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {group.title}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {group.status.replaceAll("_", " ")} ·{" "}
                      {view === "deliverables"
                        ? `${group.deliverables} deliverables`
                        : `${group.references} references · ${group.working} working`}
                    </span>
                  </span>
                  <span className="hidden text-xs text-zinc-500 sm:block">
                    {group.updatedAt ? formatRelativeTime(group.updatedAt) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!groups.length && !result.isError && (
            <p className="py-8 text-sm text-zinc-500">
              {search
                ? "No tasks or filenames match your search."
                : "No accessible files in this collection yet. Add or link files from a task’s Files panel."}
            </p>
          )}
          {result.hasNextPage && (
            <button
              type="button"
              onClick={() => void result.fetchNextPage()}
              disabled={result.isFetchingNextPage}
              className="mt-4 min-h-10 rounded border px-4"
            >
              {result.isFetchingNextPage ? "Loading…" : "Load more tasks"}
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => {
          if (!open && !unlinking) setUnlinkTarget(null);
        }}
        title="Remove file from this task?"
        description={`Remove “${unlinkTarget?.name ?? ""}” from this task. The original file and its other task links will remain unchanged.`}
        confirmLabel="Remove from task"
        loading={unlinking}
        autoCloseOnConfirm={false}
        onConfirm={async () => {
          if (!unlinkTarget || !taskId) return;
          setUnlinking(true);
          try {
            await unlinkNodeFromTask(taskId, unlinkTarget.id);
            setUnlinkTarget(null);
            void queryClient.invalidateQueries({
              queryKey: ["files-task-collections", projectId],
            });
            window.dispatchEvent(
              new CustomEvent("project:task-files-changed", {
                detail: { projectId, taskId },
              }),
            );
            toast.success(
              "File removed from this task. The original file is unchanged.",
            );
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not remove this task link",
            );
          } finally {
            setUnlinking(false);
          }
        }}
      />
    </section>
  );
}
