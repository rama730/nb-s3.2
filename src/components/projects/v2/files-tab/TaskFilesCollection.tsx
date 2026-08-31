"use client";

import React, { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FolderOpen, Loader2 } from "lucide-react";
import { unlinkNodeFromTask } from "@/app/actions/files/links";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { FolderListRowNode } from "./folder/FolderListRow";
import { toast } from "sonner";
import {
  getTaskFileGroups,
  getTaskFileGroupPage,
  type TaskCollectionEntry,
  type TaskFileGroup,
  type TaskCollectionRole,
} from "@/app/actions/files/collections";
import { FolderListView } from "./folder/FolderListView";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { useFilesWorkspaceView } from "./FilesWorkspaceViews";
import { formatRelativeTime } from "./folder/format";

export function TaskFilesCollection({ projectId }: { projectId: string }) {
  const workspace = useFilesWorkspaceView()!;
  const { taskId, query, view, selectTask } = workspace;
  const [search, setSearch] = useState(query);
  const [role, setRole] = useState<TaskCollectionRole | "all">("all");
  const [extraPages, setExtraPages] = useState<
    Record<string, { entries: TaskCollectionEntry[]; cursor: string | null }>
  >({});
  const [loadingMore, setLoadingMore] = useState(false);
  const { canEdit, canManageFiles } = useFilesTabRole();
  const [unlinkTarget, setUnlinkTarget] = useState<FolderListRowNode | null>(
    null,
  );
  const [unlinking, setUnlinking] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [search, role, view, taskId]);
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useInfiniteQuery({
    queryKey: ["files-task-collections", projectId, view, taskId, search, role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getTaskFileGroups(projectId, {
        deliverables: view === "deliverables",
        cursor: pageParam,
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
        .filter(([key]) => !key[3] && !key[4] && key[5] === "all")
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
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const groups = result.data?.pages.flatMap((page) => page.groups) ?? [];
  const selected = groups.find((group) => group.id === taskId);
  // A bookmarked task can live on a later page. Resolve it without a false empty state.
  useEffect(() => {
    if (taskId && !selected && result.hasNextPage && !result.isFetching)
      void result.fetchNextPage();
  }, [
    taskId,
    selected,
    result.hasNextPage,
    result.isFetching,
    result.fetchNextPage,
  ]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if (
        (event as CustomEvent<{ projectId?: string }>).detail?.projectId !==
        projectId
      )
        return;
      setExtraPages({});
      void queryClient.invalidateQueries({
        queryKey: ["files-task-collections", projectId],
      });
    };
    window.addEventListener("project:task-files-changed", refresh);
    return () =>
      window.removeEventListener("project:task-files-changed", refresh);
  }, [projectId, queryClient]);
  useEffect(() => {
    setExtraPages({});
    setLoadingMore(false);
  }, [search, role, view, taskId]);
  const entries = selected
    ? [...selected.entries, ...(extraPages[selected.id]?.entries ?? [])]
    : [];
  const visibleEntries = entries;
  const nextFileCursor =
    selected && extraPages[selected.id]
      ? extraPages[selected.id]!.cursor
      : selected?.nextFileCursor;
  async function moreFiles(group: TaskFileGroup) {
    if (!nextFileCursor || loadingMore) return;
    setLoadingMore(true);
    const request = generation.current;
    try {
      const page = await getTaskFileGroupPage(
        projectId,
        group.id,
        view === "deliverables",
        nextFileCursor,
        search,
        role === "all" ? undefined : role,
      );
      if (request !== generation.current) return;
      setExtraPages((previous) => ({
        ...previous,
        [group.id]: {
          entries: [...(previous[group.id]?.entries ?? []), ...page.entries],
          cursor: page.nextFileCursor,
        },
      }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load more files",
      );
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }
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
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto p-3"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {taskId && (
            <button
              type="button"
              onClick={() => selectTask(null)}
              className="mb-2 flex min-h-10 items-center gap-2 text-sm text-blue-600"
            >
              <ArrowLeft className="h-4 w-4" />
              All tasks
            </button>
          )}
          <h2 className="text-lg font-semibold">
            {selected?.title ??
              (view === "deliverables" ? "Deliverables" : "Task files")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {view === "deliverables"
              ? "Submitted outputs. A deliverable label does not imply review approval."
              : "Working files and references, grouped by task. Linked files stay in their original location."}
          </p>
        </div>
      </header>
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
      {taskId && view !== "deliverables" && (
        <label className="mb-4 block text-sm">
          Role{" "}
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value as TaskCollectionRole | "all")
            }
            className="ml-2 min-h-10 rounded border bg-transparent px-3"
          >
            <option value="all">All files</option>
            <option value="reference">References</option>
            <option value="working">Working files</option>
          </select>
        </label>
      )}
      {initialLoading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading task files…
        </div>
      ) : result.isError && !result.data ? null : taskId ? (
        selected ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <a
                href={`?tab=tasks&drawerType=task&drawerId=${selected.id}&panelTab=files`}
                className="flex min-h-10 items-center gap-2 text-sm text-blue-600"
              >
                Open task files
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <div className="min-h-48 flex-1">
              <FolderListView
                projectId={projectId}
                folderId={null}
                canEdit={canEdit}
                canManageFiles={canManageFiles}
                collection={{
                  onUnlink: canEdit ? setUnlinkTarget : undefined,
                  nodes: visibleEntries.map((entry) => entry.node),
                  labels: Object.fromEntries(
                    visibleEntries.map((entry) => [
                      entry.node.id,
                      view === "deliverables"
                        ? "Deliverable · Review status unavailable"
                        : entry.role === "reference"
                          ? "Reference"
                          : "Working file",
                    ]),
                  ),
                  emptyMessage: "No files match these filters.",
                  footer: nextFileCursor ? (
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={() => void moreFiles(selected)}
                      className="m-3 min-h-10 rounded border px-4"
                    >
                      {loadingMore ? "Loading…" : "Load more files"}
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
            setExtraPages({});
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
