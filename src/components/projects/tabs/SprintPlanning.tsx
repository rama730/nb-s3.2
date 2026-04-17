"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { toast } from "sonner";

import CreateSprintModal from "@/components/projects/v2/sprints/CreateSprintModal";
import { SprintDetailDrawer, prefetchSprintDrawerPayload } from "@/components/projects/tabs/sprint/SprintDetailDrawer";
import { SprintHeader } from "@/components/projects/tabs/sprint/SprintHeader";
import { SprintLeftRail } from "@/components/projects/tabs/sprint/SprintLeftRail";
import { SprintTimelineContent } from "@/components/projects/tabs/sprint/SprintTimelineContent";
import { SprintTimelineToolbar } from "@/components/projects/tabs/sprint/SprintTimelineToolbar";
import {
  completeSprintAction,
  createSprintAction,
  deleteSprintAction,
  fetchProjectSprintDetailAction,
  startSprintAction,
  updateSprintAction,
} from "@/app/actions/project";
import { useSprintDetail, SPRINT_DETAIL_QUERY_KEY } from "@/hooks/hub/useProjectData";
import { useSprintViewPreferences } from "@/hooks/hub/useSprintViewPreferences";
import { queryKeys } from "@/lib/query-keys";
import {
  buildProjectSprintTabHref,
  buildProjectSprintDetailHref,
  parseSprintRouteState,
  type SprintDetailPayload,
  type SprintDrawerPreview,
  type SprintDrawerState,
  type SprintListItem,
  type SprintTaskTimelineEntity,
  type SprintTimelineFilter,
  type SprintTimelineMode,
} from "@/lib/projects/sprint-detail";
import {
  insertSprintIntoInfiniteData,
  patchSprintMetadataInfiniteData,
  removeSprintFromInfiniteData,
} from "@/lib/projects/sprint-cache";
import {
  buildSprintShellSlice,
  buildSprintSummarySlice,
  buildSprintTimelineSlice,
  buildSprintTimelineViewModel,
  resolveSprintViewState,
} from "@/lib/projects/sprint-presentation";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import {
  buildSprintDeleteImpact,
  type CreateSprintDraftInput,
  type SprintDeleteImpact,
  type SprintEditorMode,
} from "@/lib/projects/sprints";

interface SprintPlanningProps {
  projectId: string;
  projectSlug: string;
  projectName?: string;
  currentUserId?: string | null;
  isOwner: boolean;
  isOwnerOrMember: boolean;
  initialSprintData?: SprintDetailPayload | null;
}

export type Sprint = SprintListItem;
export type SprintTask = SprintTaskTimelineEntity;

const DRAWER_PREFETCH_ROW_LIMIT = 80;

type SprintEditorState =
  | {
      mode: SprintEditorMode;
      sprint: SprintListItem | null;
    }
  | null;

function dedupeDrawerPreviews(previews: SprintDrawerPreview[]) {
  const seen = new Set<string>();
  return previews.filter((preview) => {
    const key = `${preview.type}:${preview.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTimelineVirtualizationThreshold(mode: SprintTimelineMode) {
  if (mode === "grouped") return 14;
  if (mode === "files") return 28;
  return 36;
}

export default function SprintPlanning({
  projectId,
  projectSlug,
  projectName,
  currentUserId = null,
  isOwner,
  isOwnerOrMember,
  initialSprintData = null,
}: SprintPlanningProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const prefetchedSprintIdsRef = useRef<Set<string>>(new Set());
  const compareMetricKeyRef = useRef<string | null>(null);
  const drawerPrefetchKeyRef = useRef<string | null>(null);

  const [editorState, setEditorState] = useState<SprintEditorState>(null);
  const [isMutatingLifecycle, setIsMutatingLifecycle] = useState(false);

  const routeState = useMemo(() => parseSprintRouteState(searchParams), [searchParams]);
  const routeSprintId = useMemo(() => {
    const match = pathname?.match(/\/projects\/[^/]+\/sprints\/([^/?#]+)/);
    return match?.[1] ?? null;
  }, [pathname]);
  const requestedSprintId = routeSprintId || initialSprintData?.selectedSprintId || null;

  const { persistedPreference, savePreference } = useSprintViewPreferences(currentUserId, projectId);
  const resolvedViewState = useMemo(
    () => resolveSprintViewState({ routeState, preference: persistedPreference }),
    [persistedPreference, routeState],
  );

  const {
    data: sprintDetailData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSprintDetail(projectId, requestedSprintId, initialSprintData ?? undefined, 24);

  const detail = sprintDetailData?.pages[0] ?? initialSprintData;
  const rows = useMemo(
    () => sprintDetailData?.pages.flatMap((page) => page.rows) ?? detail?.rows ?? [],
    [detail?.rows, sprintDetailData?.pages],
  );
  const drawerPreviews = useMemo(
    () => dedupeDrawerPreviews(sprintDetailData?.pages.flatMap((page) => page.drawerPreviews) ?? detail?.drawerPreviews ?? []),
    [detail?.drawerPreviews, sprintDetailData?.pages],
  );
  const drawerPreviewMap = useMemo(
    () => new Map(drawerPreviews.map((preview) => [`${preview.type}:${preview.id}`, preview])),
    [drawerPreviews],
  );

  const selectedSprintId = detail?.selectedSprintId ?? null;
  const selectedSprint = detail?.sprints.find((sprint) => sprint.id === selectedSprintId) ?? null;
  const permissions = detail?.permissions ?? {
    canRead: true,
    canWrite: isOwnerOrMember,
    canCreate: isOwnerOrMember,
    canStart: isOwnerOrMember,
    canComplete: isOwnerOrMember,
    isOwner,
    isMember: isOwnerOrMember && !isOwner,
    memberRole: isOwner ? "owner" : isOwnerOrMember ? "member" : "viewer",
  };
  const isEditorOpen = editorState !== null;
  const deleteImpact: SprintDeleteImpact | null =
    editorState?.mode === "edit" && editorState.sprint && detail?.summary && selectedSprintId === editorState.sprint.id
      ? buildSprintDeleteImpact({
          sprint: editorState.sprint,
          affectedTaskCount: detail.summary.totalTasks,
        })
      : null;

  const timelineView = useMemo(
    () =>
      buildSprintTimelineViewModel({
        rows,
        mode: resolvedViewState.mode,
        filter: resolvedViewState.filter,
      }),
    [resolvedViewState.filter, resolvedViewState.mode, rows],
  );
  const shouldVirtualize =
    (timelineView.mode === "grouped" ? timelineView.groups.length : timelineView.rows.length) >=
    getTimelineVirtualizationThreshold(timelineView.mode);
  const drawer = routeState.drawer;
  const activeDrawerPreview =
    drawer.type === "none" ? null : drawerPreviewMap.get(`${drawer.type}:${drawer.id}`) ?? null;

  const syncSliceCaches = useCallback(
    (payload: SprintDetailPayload, combinedRows: typeof rows, combinedDrawerPreviews: SprintDrawerPreview[]) => {
      queryClient.setQueryData(
        queryKeys.project.detail.sprintDetailShell(projectId, payload.selectedSprintId),
        buildSprintShellSlice(payload),
      );
      queryClient.setQueryData(
        queryKeys.project.detail.sprintDetailSummary(projectId, payload.selectedSprintId),
        buildSprintSummarySlice(payload),
      );
      queryClient.setQueryData(queryKeys.project.detail.sprintTimeline(projectId, payload.selectedSprintId), {
        ...buildSprintTimelineSlice(payload),
        rows: combinedRows,
        drawerPreviews: combinedDrawerPreviews,
      });
    },
    [projectId, queryClient, rows],
  );

  useEffect(() => {
    if (!detail) return;
    syncSliceCaches(detail, rows, drawerPreviews);
  }, [detail, drawerPreviews, rows, syncSliceCaches]);

  const replaceRouteState = useCallback(
    (next: {
      filter?: SprintTimelineFilter;
      mode?: SprintTimelineMode;
      drawer?: SprintDrawerState;
    }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (pathname?.includes("/sprints/")) {
        params.delete("tab");
      } else {
        params.set("tab", "sprints");
      }

      const filter = next.filter ?? resolvedViewState.filter;
      const mode = next.mode ?? resolvedViewState.mode;
      const drawerState = next.drawer ?? routeState.drawer;

      if (filter === "all") params.delete("filter");
      else params.set("filter", filter);

      if (mode === "chronological") params.delete("mode");
      else params.set("mode", mode);

      if (drawerState.type === "none") {
        params.delete("drawerType");
        params.delete("drawerId");
      } else {
        params.set("drawerType", drawerState.type);
        params.set("drawerId", drawerState.id);
      }

      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, resolvedViewState.filter, resolvedViewState.mode, routeState.drawer, router, searchParams],
  );

  const patchSprintDetailCache = useCallback(
    (updater: (page: SprintDetailPayload) => SprintDetailPayload) => {
      queryClient.setQueriesData(
        { queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) },
        (existing: unknown) => {
          if (!existing || typeof existing !== "object" || !("pages" in existing)) return existing;
          const infiniteData = existing as { pages: SprintDetailPayload[]; pageParams: unknown[] };
          const nextPages = infiniteData.pages.map(updater);
          const head = nextPages[0];
          if (head) {
            syncSliceCaches(
              head,
              nextPages.flatMap((page) => page.rows),
              dedupeDrawerPreviews(nextPages.flatMap((page) => page.drawerPreviews)),
            );
          }
          return {
            ...infiniteData,
            pages: nextPages,
          };
        },
      );
    },
    [projectId, queryClient, syncSliceCaches],
  );

  const patchSprintRootData = useCallback(
    (updater: (existing: unknown) => unknown) => {
      queryClient.setQueriesData(
        { queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) },
        (existing: unknown) => {
          const next = updater(existing);
          if (
            next &&
            typeof next === "object" &&
            "pages" in next &&
            Array.isArray((next as { pages: unknown }).pages)
          ) {
            const infiniteData = next as { pages: SprintDetailPayload[]; pageParams: unknown[] };
            const head = infiniteData.pages[0];
            if (head) {
              syncSliceCaches(
                head,
                infiniteData.pages.flatMap((page) => page.rows),
                dedupeDrawerPreviews(infiniteData.pages.flatMap((page) => page.drawerPreviews)),
              );
            }
          }
          return next;
        },
      );
    },
    [projectId, queryClient, syncSliceCaches],
  );

  const patchSelectedSprintStatus = useCallback(
    (sprintId: string, status: SprintListItem["status"]) => {
      patchSprintDetailCache((page) => {
        const nextSprints = page.sprints.map((sprint) => (sprint.id === sprintId ? { ...sprint, status } : sprint));
        const nextRows = page.rows.map((row) => {
          if ((row.kind === "kickoff" || row.kind === "closeout") && row.sprint.id === sprintId) {
            return { ...row, sprint: { ...row.sprint, status } };
          }
          return row;
        });
        return {
          ...page,
          sprints: nextSprints,
          rows: nextRows,
        };
      });
      queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), (existing: unknown) =>
        Array.isArray(existing)
          ? existing.map((sprint) => (sprint?.id === sprintId ? { ...sprint, status } : sprint))
          : existing,
      );
    },
    [patchSprintDetailCache, projectId, queryClient],
  );

  const prefetchSprintDetail = useCallback(
    async (sprintId: string) => {
      if (!sprintId || prefetchedSprintIdsRef.current.has(sprintId)) return;
      prefetchedSprintIdsRef.current.add(sprintId);

      const queryKey = SPRINT_DETAIL_QUERY_KEY(projectId, sprintId);
      const existing = queryClient.getQueryData(queryKey);
      if (existing) return;

      await queryClient.prefetchInfiniteQuery({
        queryKey,
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
          const result = await fetchProjectSprintDetailAction({
            projectId,
            sprintId,
            cursor: pageParam,
            limit: 24,
          });
          if (!result.success) throw new Error(result.error);
          return result.data;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage: SprintDetailPayload) => lastPage.nextCursor,
        staleTime: 1000 * 60 * 2,
      });

      const prefetched = queryClient.getQueryData(queryKey) as
        | { pages: SprintDetailPayload[]; pageParams: unknown[] }
        | undefined;
      if (prefetched?.pages?.[0]) {
        syncSliceCaches(
          prefetched.pages[0],
          prefetched.pages.flatMap((page) => page.rows),
          dedupeDrawerPreviews(prefetched.pages.flatMap((page) => page.drawerPreviews)),
        );
      }
    },
    [projectId, queryClient, syncSliceCaches],
  );

  const handleSelectSprint = useCallback(
    (sprintId: string) => {
      const wasPrefetched = !!queryClient.getQueryData(SPRINT_DETAIL_QUERY_KEY(projectId, sprintId));
      recordSprintMetric("project.sprint.prefetch.selection", {
        projectId,
        sprintId,
        hit: wasPrefetched,
      });
    },
    [projectId, queryClient],
  );

  const handleModeChange = useCallback(
    (mode: SprintTimelineMode) => {
      const nextFilter =
        mode === "files" && resolvedViewState.filter === "files" ? "all" : resolvedViewState.filter;

      savePreference({ mode, filter: nextFilter });
      replaceRouteState({ mode, filter: nextFilter });
      recordSprintMetric("project.sprint.timeline.mode", {
        projectId,
        sprintId: selectedSprintId,
        mode,
      });
    },
    [projectId, replaceRouteState, resolvedViewState.filter, savePreference, selectedSprintId],
  );

  const handleFilterChange = useCallback(
    (filter: SprintTimelineFilter) => {
      savePreference({ mode: resolvedViewState.mode, filter });
      replaceRouteState({ filter });
      recordSprintMetric("project.sprint.timeline.filter", {
        projectId,
        sprintId: selectedSprintId,
        filter,
        mode: resolvedViewState.mode,
      });
    },
    [projectId, replaceRouteState, resolvedViewState.mode, savePreference, selectedSprintId],
  );

  const handleOpenDrawer = useCallback(
    (nextDrawer: SprintDrawerState) => {
      replaceRouteState({ drawer: nextDrawer });
      recordSprintMetric("project.sprint.timeline.drawer_open", {
        projectId,
        sprintId: selectedSprintId,
        drawerType: nextDrawer.type,
        drawerId: nextDrawer.id,
      });
    },
    [projectId, replaceRouteState, selectedSprintId],
  );

  const handleCloseDrawer = useCallback(() => {
    replaceRouteState({ drawer: { type: "none", id: null } });
  }, [replaceRouteState]);

  const handlePrefetchDrawer = useCallback(
    async (nextDrawer: SprintDrawerState) => {
      if (rows.length > DRAWER_PREFETCH_ROW_LIMIT || nextDrawer.type === "none") return;
      const key = `${nextDrawer.type}:${nextDrawer.id}`;
      if (drawerPrefetchKeyRef.current === key) return;
      drawerPrefetchKeyRef.current = key;
      await prefetchSprintDrawerPayload(queryClient, projectId, nextDrawer);
    },
    [projectId, queryClient, rows.length],
  );

  const toSprintListItem = useCallback((sprint: {
    id: string;
    projectId: string;
    name: string;
    goal: string | null;
    description?: string | null;
    startDate: Date | string | null;
    endDate: Date | string | null;
    status: SprintListItem["status"];
    createdAt: Date | string | null;
    updatedAt: Date | string | null;
  }): SprintListItem => ({
    id: sprint.id,
    projectId: sprint.projectId,
    name: sprint.name,
    goal: sprint.goal ?? null,
    description: sprint.description ?? null,
    startDate: typeof sprint.startDate === "string" ? sprint.startDate : sprint.startDate?.toISOString?.() ?? null,
    endDate: typeof sprint.endDate === "string" ? sprint.endDate : sprint.endDate?.toISOString?.() ?? null,
    status: sprint.status,
    createdAt: typeof sprint.createdAt === "string" ? sprint.createdAt : sprint.createdAt?.toISOString?.() ?? null,
    updatedAt: typeof sprint.updatedAt === "string" ? sprint.updatedAt : sprint.updatedAt?.toISOString?.() ?? null,
  }), []);

  const handleCreateSprint = useCallback(
    async (data: CreateSprintDraftInput) => {
      const startedAt = Date.now();
      try {
        const result = await createSprintAction({ ...data, projectId });
        if (!result.success || !result.sprint) {
          return { success: false as const, error: result.error };
        }

        const nextSprint = toSprintListItem(result.sprint);
        patchSprintRootData((existing) => insertSprintIntoInfiniteData(existing, nextSprint));
        queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), (existing: unknown) =>
          Array.isArray(existing) ? [nextSprint, ...existing.filter((item) => item?.id !== nextSprint.id)] : [nextSprint],
        );
        toast.success("Sprint created");
        recordSprintMetric("project.sprint.editor.create", {
          projectId,
          sprintId: nextSprint.id,
          success: true,
          durationMs: Date.now() - startedAt,
        });

        await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
        router.push(
          buildProjectSprintDetailHref(projectSlug, nextSprint.id, {
            filter: resolvedViewState.filter,
            mode: resolvedViewState.mode,
          }),
          { scroll: false },
        );
        return { success: true as const };
      } catch (error) {
        recordSprintMetric("project.sprint.editor.create", {
          projectId,
          success: false,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : "Failed to create sprint",
        });
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to create sprint",
        };
      }
    },
    [patchSprintRootData, projectId, projectSlug, queryClient, resolvedViewState.filter, resolvedViewState.mode, router, toSprintListItem],
  );

  const handleUpdateSprint = useCallback(
    async (data: CreateSprintDraftInput) => {
      if (!editorState?.sprint) {
        return { success: false as const, error: "Sprint not found" };
      }

      const startedAt = Date.now();
      const previousStates = queryClient.getQueriesData({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      const previousSprintList = queryClient.getQueryData(queryKeys.project.detail.sprints(projectId));
      const updatedSprint: SprintListItem = {
        ...editorState.sprint,
        name: data.name,
        goal: data.goal ?? null,
        description: data.description ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
      };

      patchSprintRootData((existing) => patchSprintMetadataInfiniteData(existing, updatedSprint));
      queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), (existing: unknown) =>
        Array.isArray(existing)
          ? existing.map((sprint) => (sprint?.id === updatedSprint.id ? updatedSprint : sprint))
          : existing,
      );

      try {
        const result = await updateSprintAction({
          projectId,
          sprintId: editorState.sprint.id,
          ...data,
        });

        if (!result.success || !result.sprint) {
          throw new Error(result.error ?? "Failed to update sprint");
        }

        const nextSprint = toSprintListItem(result.sprint);
        patchSprintRootData((existing) => patchSprintMetadataInfiniteData(existing, nextSprint));
        queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), (existing: unknown) =>
          Array.isArray(existing)
            ? existing.map((sprint) => (sprint?.id === nextSprint.id ? nextSprint : sprint))
            : existing,
        );
        toast.success("Sprint updated");
        recordSprintMetric("project.sprint.editor.update", {
          projectId,
          sprintId: editorState.sprint.id,
          success: true,
          durationMs: Date.now() - startedAt,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
        return { success: true as const };
      } catch (error) {
        for (const [queryKey, snapshot] of previousStates) {
          queryClient.setQueryData(queryKey, snapshot);
        }
        queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), previousSprintList);
        recordSprintMetric("project.sprint.editor.update", {
          projectId,
          sprintId: editorState.sprint.id,
          success: false,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : "Failed to update sprint",
        });
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to update sprint",
        };
      }
    },
    [editorState?.sprint, patchSprintRootData, projectId, queryClient, toSprintListItem],
  );

  const handleDeleteSprint = useCallback(
    async () => {
      if (!editorState?.sprint) {
        return { success: false as const, error: "Sprint not found" };
      }

      const startedAt = Date.now();
      const deletedSprint = editorState.sprint;
      const remainingSprints = detail?.sprints.filter((sprint) => sprint.id !== deletedSprint.id) ?? [];
      const nextSelectedSprint = remainingSprints[0] ?? null;
      const previousStates = queryClient.getQueriesData({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      const previousSprintList = queryClient.getQueryData(queryKeys.project.detail.sprints(projectId));

      patchSprintRootData((existing) => removeSprintFromInfiniteData(existing, deletedSprint.id, nextSelectedSprint?.id ?? null));
      queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), (existing: unknown) =>
        Array.isArray(existing) ? existing.filter((sprint) => sprint?.id !== deletedSprint.id) : existing,
      );
      router.replace(
        nextSelectedSprint
          ? buildProjectSprintDetailHref(projectSlug, nextSelectedSprint.id, {
              filter: resolvedViewState.filter,
              mode: resolvedViewState.mode,
            })
          : buildProjectSprintTabHref(projectSlug, {
              filter: resolvedViewState.filter,
              mode: resolvedViewState.mode,
            }),
        { scroll: false },
      );

      try {
        const result = await deleteSprintAction({
          projectId,
          sprintId: deletedSprint.id,
        });

        if (!result.success) {
          throw new Error(result.error ?? "Failed to delete sprint");
        }

        toast.success(
          result.affectedTaskCount
            ? `Sprint deleted and ${result.affectedTaskCount} work item${result.affectedTaskCount === 1 ? "" : "s"} unassigned`
            : "Sprint deleted",
        );
        recordSprintMetric("project.sprint.editor.delete", {
          projectId,
          sprintId: deletedSprint.id,
          success: true,
          durationMs: Date.now() - startedAt,
          affectedTaskCount: result.affectedTaskCount ?? 0,
          previousStatus: result.previousStatus ?? deletedSprint.status,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
        return { success: true as const };
      } catch (error) {
        for (const [queryKey, snapshot] of previousStates) {
          queryClient.setQueryData(queryKey, snapshot);
        }
        queryClient.setQueryData(queryKeys.project.detail.sprints(projectId), previousSprintList);
        router.replace(
          buildProjectSprintDetailHref(projectSlug, deletedSprint.id, {
            filter: resolvedViewState.filter,
            mode: resolvedViewState.mode,
          }),
          { scroll: false },
        );
        recordSprintMetric("project.sprint.editor.delete", {
          projectId,
          sprintId: deletedSprint.id,
          success: false,
          durationMs: Date.now() - startedAt,
          affectedTaskCount: deleteImpact?.affectedTaskCount ?? 0,
          message: error instanceof Error ? error.message : "Failed to delete sprint",
        });
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to delete sprint",
        };
      }
    },
    [deleteImpact?.affectedTaskCount, detail?.sprints, editorState?.sprint, patchSprintRootData, projectId, projectSlug, queryClient, resolvedViewState.filter, resolvedViewState.mode, router],
  );

  const runLifecycleMutation = useCallback(
    async (mode: "start" | "complete") => {
      if (!selectedSprintId || !selectedSprint) return;
      setIsMutatingLifecycle(true);
      const previousStates = queryClient.getQueriesData({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      const nextStatus = mode === "start" ? "active" : "completed";

      patchSelectedSprintStatus(selectedSprintId, nextStatus);

      try {
        const result =
          mode === "start"
            ? await startSprintAction(selectedSprintId, projectId)
            : await completeSprintAction(selectedSprintId, projectId);

        if (!result.success) {
          throw new Error(result.error || `Failed to ${mode} sprint`);
        }

        toast.success(mode === "start" ? "Sprint started" : "Sprint completed");
        await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      } catch (error) {
        for (const [queryKey, snapshot] of previousStates) {
          queryClient.setQueryData(queryKey, snapshot);
        }
        toast.error(error instanceof Error ? error.message : `Failed to ${mode} sprint`);
      } finally {
        setIsMutatingLifecycle(false);
      }
    },
    [patchSelectedSprintStatus, projectId, queryClient, selectedSprint, selectedSprintId],
  );

  const handleLoadMore = useCallback(async () => {
    const startedAt = Date.now();
    const container = timelineScrollRef.current;
    const previousBottomOffset = container ? container.scrollHeight - container.scrollTop : null;

    await fetchNextPage();

    requestAnimationFrame(() => {
      if (container && previousBottomOffset !== null) {
        container.scrollTop = container.scrollHeight - previousBottomOffset;
      }
    });

    recordSprintMetric("project.sprint.timeline.pagination_ms", {
      projectId,
      sprintId: selectedSprintId,
      durationMs: Date.now() - startedAt,
    });
  }, [fetchNextPage, projectId, selectedSprintId]);

  useEffect(() => {
    if (!pathname?.includes("/sprints/")) return;
    if (!selectedSprintId || routeSprintId === selectedSprintId) return;
    router.replace(
      buildProjectSprintDetailHref(projectSlug, selectedSprintId, {
        filter: resolvedViewState.filter,
        mode: resolvedViewState.mode,
        drawer: routeState.drawer,
      }),
      { scroll: false },
    );
  }, [
    pathname,
    projectSlug,
    resolvedViewState.filter,
    resolvedViewState.mode,
    routeSprintId,
    routeState.drawer,
    router,
    selectedSprintId,
  ]);

  useEffect(() => {
    if (!selectedSprintId || !detail?.compareSummary) return;
    const key = `${selectedSprintId}:${detail.compareSummary.baselineKind}`;
    if (compareMetricKeyRef.current === key) return;
    compareMetricKeyRef.current = key;
    recordSprintMetric("project.sprint.compare.visibility", {
      projectId,
      sprintId: selectedSprintId,
      baselineKind: detail.compareSummary.baselineKind,
      hasPreviousSprint: detail.compareSummary.baselineKind === "previous_sprint",
    });
  }, [detail?.compareSummary, projectId, selectedSprintId]);

  useEffect(() => {
    if (!editorState) return;
    recordSprintMetric("project.sprint.editor.open", {
      projectId,
      sprintId: editorState.sprint?.id ?? null,
      mode: editorState.mode,
    });
  }, [editorState, projectId]);

  if (isLoading && !detail) {
    return (
      <div className="flex h-full min-h-0 gap-6 overflow-hidden">
        <div className="w-[280px] flex-shrink-0 space-y-3">
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="space-y-2">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-20 w-full animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
        </div>
        <div className="flex-1 rounded-[28px] border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="space-y-4 p-8">
            <div className="h-4 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-8 w-64 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-96 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="pt-6 space-y-8">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-24 w-full animate-pulse rounded-2xl bg-zinc-100/70 dark:bg-zinc-900" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!detail || detail.sprints.length === 0) {
    return (
      <div className="flex h-[500px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-6 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="max-w-md space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <CalendarDays className="h-8 w-8 text-zinc-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No sprints yet</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Create the first sprint and this space will turn into a clean execution timeline for the work inside it.
            </p>
          </div>
          {permissions.canCreate ? (
            <>
              <button
                type="button"
                onClick={() => setEditorState({ mode: "create", sprint: null })}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Plus className="h-4 w-4" />
                Create Sprint
              </button>
              <CreateSprintModal
                projectId={projectId}
                isOpen={isEditorOpen}
                mode="create"
                onClose={() => setEditorState(null)}
                onSubmit={handleCreateSprint}
                sprintCount={0}
              />
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 gap-6 overflow-hidden">
        <SprintLeftRail
          projectSlug={projectSlug}
          sprints={detail.sprints}
          selectedSprintId={selectedSprintId}
          filter={resolvedViewState.filter}
          mode={resolvedViewState.mode}
          canCreate={permissions.canCreate}
          onCreate={() => setEditorState({ mode: "create", sprint: null })}
          onSelect={handleSelectSprint}
          onPrefetch={prefetchSprintDetail}
        />

        <section className="flex min-h-0 flex-1 overflow-hidden rounded-[28px] border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedSprint ? (
              <SprintHeader
                sprint={selectedSprint}
                summary={detail.summary}
                compareSummary={detail.compareSummary}
                permissions={permissions}
                isMutatingLifecycle={isMutatingLifecycle}
                projectSlug={projectSlug}
                onEdit={() => setEditorState({ mode: "edit", sprint: selectedSprint })}
                onStart={() => void runLifecycleMutation("start")}
                onComplete={() => void runLifecycleMutation("complete")}
              />
            ) : null}

            <SprintTimelineToolbar
              mode={resolvedViewState.mode}
              filter={resolvedViewState.filter}
              visibleCounts={timelineView.visibleCounts}
              onModeChange={handleModeChange}
              onFilterChange={handleFilterChange}
            />

            <div ref={timelineScrollRef} className="min-h-0 flex-1 overflow-y-auto app-scroll app-scroll-y app-scroll-gutter">
              <SprintTimelineContent
                viewModel={timelineView}
                projectSlug={projectSlug}
                shouldVirtualize={shouldVirtualize}
                hasMore={hasNextPage ?? false}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={() => void handleLoadMore()}
                onOpenDrawer={handleOpenDrawer}
                onPrefetchDrawer={(nextDrawer) => {
                  void handlePrefetchDrawer(nextDrawer);
                }}
              />
            </div>
          </div>

          {drawer.type !== "none" ? (
            <SprintDetailDrawer
              projectId={projectId}
              projectSlug={projectSlug}
              projectName={projectName}
              drawer={drawer}
              preview={activeDrawerPreview}
              onClose={handleCloseDrawer}
            />
          ) : null}
        </section>
      </div>

      <CreateSprintModal
        projectId={projectId}
        isOpen={isEditorOpen}
        mode={editorState?.mode ?? "create"}
        onClose={() => setEditorState(null)}
        onSubmit={editorState?.mode === "edit" ? handleUpdateSprint : handleCreateSprint}
        onDelete={editorState?.mode === "edit" ? handleDeleteSprint : undefined}
        sprint={editorState?.sprint ?? null}
        sprintCount={detail.sprints.length}
        deleteImpact={deleteImpact}
      />
    </>
  );
}
