"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { toast } from "sonner";

import { SprintHeader } from "@/components/projects/tabs/sprint/SprintHeader";
import { SprintLeftRail } from "@/components/projects/tabs/sprint/SprintLeftRail";
import { SprintTimelineContent } from "@/components/projects/tabs/sprint/SprintTimelineContent";
import { SprintLifecycleModals } from "@/components/projects/tabs/sprint/SprintLifecycleModals";
import {
  archiveSprintAction,
  cancelSprintAction,
  completeSprintAction,
  createSprintAction,
  deleteSprintAction,
  updateSprintAction,
} from "@/app/actions/project";
import {
  useSprintDetail,
} from "@/hooks/hub/useProjectTasksData";
import { queryKeys } from "@/lib/query-keys";
import {
  buildProjectSprintDetailHref,
  type SprintDetailPayload,
  type SprintListItem,
  type SprintTaskTimelineEntity,
} from "@/lib/projects/sprint-detail";

import {
  buildSprintDeleteImpact,
  type CreateSprintDraftInput,
  type SprintDeleteImpact,
  type SprintEditorMode,
} from "@/lib/projects/sprints";
import { cn } from "@/lib/utils";

const CreateSprintModal = dynamic(
  () => import("@/components/projects/v2/sprints/CreateSprintModal"),
  { ssr: false },
);

interface SprintPlanningProps {
  projectId: string;
  projectSlug: string;
  projectName?: string;
  projectKey?: string | null;
  isOwner: boolean;
  isOwnerOrMember: boolean;
  initialSprintData?: SprintDetailPayload | null;
}

export type Sprint = SprintListItem;
export type SprintTask = SprintTaskTimelineEntity;

type SprintEditorState = {
  mode: SprintEditorMode;
  sprint: SprintListItem | null;
} | null;

export default function SprintPlanning({
  projectId,
  projectSlug,
  projectName: _projectName,
  projectKey,
  isOwner,
  isOwnerOrMember,
  initialSprintData = null,
}: SprintPlanningProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();


  const [editorState, setEditorState] = useState<SprintEditorState>(null);
  const [isMutatingLifecycle, setIsMutatingLifecycle] = useState(false);
  const [activeModal, setActiveModal] = useState<"complete" | "archive" | "cancel" | null>(null);

  const routeSprintId = useMemo(() => {
    const match = pathname?.match(/\/projects\/[^/]+\/sprints\/([^/?#]+)/);
    return match?.[1] ?? null;
  }, [pathname]);
  const legacyRouteSprintId = searchParams?.get("sprintId") ?? null;
  const routeSprintReference = searchParams?.get("sprint") ?? null;
  const requestedSprintId =
    routeSprintId || legacyRouteSprintId || routeSprintReference || initialSprintData?.selectedSprintId || null;

  const {
    data: detail,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSprintDetail(
    projectId,
    requestedSprintId,
    null,
    initialSprintData ?? undefined,
  );

  const rows = useMemo(() => detail?.rows ?? [], [detail?.rows]);

  const selectedSprintId = detail?.selectedSprintId ?? null;
  const selectedSprint =
    detail?.sprints.find((sprint) => sprint.id === selectedSprintId) ?? null;

  useEffect(() => {
    if (!selectedSprint) return;
    const needsCanonicalCode =
      Boolean(legacyRouteSprintId) ||
      (Boolean(routeSprintReference) && routeSprintReference?.toLowerCase() !== selectedSprint.code.toLowerCase());
    if (!needsCanonicalCode) return;
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("sprintId");
    params.set("sprint", selectedSprint.code);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [legacyRouteSprintId, pathname, routeSprintReference, router, searchParams, selectedSprint]);
  const permissions = detail?.permissions ?? {
    canRead: true,
    canWrite: isOwner,
    canCreate: isOwner,
    canStart: isOwner,
    canComplete: isOwner,
    isOwner,
    isMember: isOwnerOrMember && !isOwner,
    memberRole: isOwner ? "owner" : isOwnerOrMember ? "member" : "viewer",
  };
  const isEditorOpen = editorState !== null;
  const deleteImpact: SprintDeleteImpact | null =
    editorState?.mode === "edit" &&
    editorState.sprint &&
    detail?.summary &&
    selectedSprintId === editorState.sprint.id
      ? buildSprintDeleteImpact({
          sprint: editorState.sprint,
          affectedTaskCount: detail.summary.totalTasks,
        })
      : null;


  const handleCreateSprint = useCallback(
    async (data: CreateSprintDraftInput) => {
      try {
        const result = await createSprintAction({ ...data, projectId });
        if (!result.success || !result.sprint) {
          return { success: false as const, error: result.error };
        }

        toast.success("Sprint created");
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprints(projectId),
        });
        router.push(buildProjectSprintDetailHref(projectSlug, result.sprint.id, { sprintCode: result.sprint.code }), { scroll: false });
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to create sprint",
        };
      }
    },
    [projectId, projectSlug, queryClient, router],
  );

  const handleUpdateSprint = useCallback(
    async (data: CreateSprintDraftInput) => {
      if (!editorState?.sprint) {
        return { success: false as const, error: "Sprint not found" };
      }

      try {
        const result = await updateSprintAction({
          projectId,
          sprintId: editorState.sprint.id,
          ...data,
        });

        if (!result.success || !result.sprint) {
          throw new Error(result.error ?? "Failed to update sprint");
        }

        toast.success("Sprint updated");
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprints(projectId),
        });
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to update sprint",
        };
      }
    },
    [editorState?.sprint, projectId, queryClient],
  );

  const handleDeleteSprint = useCallback(async () => {
    if (!editorState?.sprint) {
      return { success: false as const, error: "Sprint not found" };
    }

    const deletedSprint = editorState.sprint;
    const remainingSprints = detail?.sprints.filter((sprint) => sprint.id !== deletedSprint.id) ?? [];
    const nextSelectedSprint = remainingSprints[0] ?? null;

    try {
      const result = await deleteSprintAction({
        projectId,
        sprintId: deletedSprint.id,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Failed to delete sprint");
      }

      toast.success("Sprint deleted");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprints(projectId),
      });
      router.replace(
        nextSelectedSprint
          ? buildProjectSprintDetailHref(projectSlug, nextSelectedSprint.id, { sprintCode: nextSelectedSprint.code })
          : `/projects/${encodeURIComponent(projectSlug)}?tab=sprints`,
        { scroll: false },
      );
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to delete sprint",
      };
    }
  }, [detail?.sprints, editorState?.sprint, projectId, projectSlug, queryClient, router]);

  const applyLifecycleResult = useCallback(
    async (
      action: () => Promise<{ success: boolean; sprint?: SprintListItem; error?: string }>,
      successMessage: string,
    ) => {
      setIsMutatingLifecycle(true);
      try {
        const result = await action();
        if (!result.success || !result.sprint) {
          throw new Error(result.error || "The Sprint could not be updated");
        }

        toast.success(successMessage);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprints(projectId),
        });
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The Sprint could not be updated");
        return false;
      } finally {
        setIsMutatingLifecycle(false);
      }
    },
    [projectId, queryClient],
  );

  const archiveSelectedSprint = useCallback(async () => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => archiveSprintAction(selectedSprintId, projectId),
      "Sprint archived",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);

  const cancelSelectedSprint = useCallback(async () => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => cancelSprintAction(selectedSprintId, projectId),
      "Sprint cancelled",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);

  const completeSelectedSprint = useCallback(async (
    unfinished: "keep" | "backlog" | "next_sprint",
    nextSprintId: string | null,
  ) => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => completeSprintAction(selectedSprintId, projectId, { unfinished, nextSprintId }),
      "Sprint completed",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);


  if (isLoading && !detail) {
    return (
      <div className="flex h-full min-h-0 gap-6 overflow-hidden">
        <div className="w-[280px] flex-shrink-0 space-y-3">
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="space-y-2">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-20 w-full animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800"
              />
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
                <div
                  key={item}
                  className="h-24 w-full animate-pulse rounded-2xl bg-zinc-100/70 dark:bg-zinc-900"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError && !detail) {
    return (
      <div className="flex h-[500px] flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <div className="max-w-md space-y-3">
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Sprint activity could not be loaded</h2>
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{error instanceof Error ? error.message : "Please try again."}</p>
          <button type="button" onClick={() => void refetch()} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900">Try again</button>
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
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              No sprints yet
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Create the first sprint and this space will turn into a clean
              execution timeline for the work inside it.
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
              {isEditorOpen ? (
                <CreateSprintModal
                  projectId={projectId}
                  isOpen={isEditorOpen}
                  mode="create"
                  onClose={() => setEditorState(null)}
                  onSubmit={handleCreateSprint}
                  sprintCount={0}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid min-h-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <SprintLeftRail
          projectSlug={projectSlug}
          sprints={detail.sprints}
          selectedSprintId={selectedSprint?.id ?? null}
          canCreate={permissions.canCreate}
          onCreate={() => setEditorState({ mode: "create", sprint: null })}
        />

        <section className="min-w-0 pb-12">
          <div className="flex-1 min-w-0">
            {selectedSprint ? (
              <SprintHeader
                sprint={selectedSprint}
                permissions={permissions}
                isMutatingLifecycle={isMutatingLifecycle}
                onEdit={() => setEditorState({ mode: "edit", sprint: selectedSprint })}
                onComplete={() => setActiveModal("complete")}
                onArchive={() => setActiveModal("archive")}
                onCancel={() => setActiveModal("cancel")}
              />
            ) : null}
            <SprintTimelineContent
              projectSlug={projectSlug}
              projectKey={projectKey}
              sprintReference={selectedSprint?.code ?? null}
              sprint={selectedSprint}
              summary={detail.summary}
              rows={rows}
              hasMore={Boolean(hasNextPage)}
              isLoadingMore={isFetchingNextPage}
              onLoadMore={() => void fetchNextPage()}
            />
          </div>
        </section>
      </div>

      {isEditorOpen ? (
        <CreateSprintModal
          projectId={projectId}
          isOpen={isEditorOpen}
          mode={editorState?.mode ?? "create"}
          onClose={() => setEditorState(null)}
          onSubmit={
            editorState?.mode === "edit"
              ? handleUpdateSprint
              : handleCreateSprint
          }
          onDelete={
            editorState?.mode === "edit" ? handleDeleteSprint : undefined
          }
          sprint={editorState?.sprint ?? null}
          sprintCount={detail.sprints.length}
          deleteImpact={deleteImpact}
        />
      ) : null}

      <SprintLifecycleModals
        selectedSprint={selectedSprint}
        sprints={detail.sprints}
        summary={detail.summary}
        isMutating={isMutatingLifecycle}
        openModal={activeModal}
        onClose={() => setActiveModal(null)}
        onConfirmComplete={completeSelectedSprint}
        onConfirmArchive={archiveSelectedSprint}
        onConfirmCancel={cancelSelectedSprint}
      />
    </>
  );
}
