"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes } from "@/app/actions/files/nodes";
import { updateTaskNodeLink } from "@/app/actions/files/links";
import {
  moveProjectNodes,
} from "@/app/actions/files/mutations";
import { MoveDialog } from "@/components/projects/v2/explorer/ExplorerDialogsHost";
import { TaskFileRow } from "@/components/projects/v2/tasks/components/TaskFileRow";
import { toast } from "sonner";
import { composeAnnotation } from "@/lib/projects/task-file-label";
import { TASK_WORKING_FILES_TITLE } from "@/lib/files/task-working-files";
import {
  inferTaskFileRole,
  replaceTaskFileRoleTag,
  type TaskFileRole,
} from "@/lib/projects/task-file-intelligence";

type LinkedTaskNode = ProjectNode & {
  order?: number;
  annotation?: string | null;
  tags?: string[] | null;
};

interface TaskFilesExplorerProps {
  taskId: string;
  projectId: string;
  linkedNodes: LinkedTaskNode[];
  canEdit: boolean;
  canManageFiles?: boolean;
  onUnlink?: (nodeId: string) => void;
  onOpenFile?: (node: ProjectNode) => void;
  onShowHistory?: (node: ProjectNode) => void;
  onReplaceWithNewVersion?: (
    node: ProjectNode,
    file: File,
  ) => Promise<{ success: boolean; error?: string }> | void;
  highlightedNodeId?: string | null;
  onFilesChanged?: () => Promise<unknown> | void;
}

export function TaskFilesExplorer({
  taskId,
  projectId,
  linkedNodes,
  canEdit,
  canManageFiles = false,
  onUnlink,
  onOpenFile,
  onShowHistory,
  onReplaceWithNewVersion,
  highlightedNodeId = null,
  onFilesChanged,
}: TaskFilesExplorerProps) {
  // Simple local state for folder expansion and loaded children
  const [expandedFolderIds, setExpandedFolderIds] = useState<
    Record<string, boolean>
  >({});
  const [loadedChildren, setLoadedChildren] = useState<
    Record<string, ProjectNode[]>
  >({});
  const [childCursors, setChildCursors] = useState<Record<string, string | null>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>(
    {},
  );
  const [locationDialog, setLocationDialog] = useState<{
    open: boolean;
    nodes: ProjectNode[];
    targetFolderId: string | null;
    mode: "move" | "publish";
  }>({ open: false, nodes: [], targetFolderId: null, mode: "move" });

  const confirmLocationChange = useCallback(async () => {
    if (!locationDialog.nodes.length || !canManageFiles) return;
    const ids = locationDialog.nodes.map((node) => node.id);
    try {
      const result = locationDialog.mode === "publish"
        ? await moveProjectNodes(ids, locationDialog.targetFolderId, projectId, { mode: "publish" })
        : await moveProjectNodes(ids, locationDialog.targetFolderId, projectId);
      if (result.nodes.length > 0) {
        toast.success(
          locationDialog.mode === "publish"
            ? "Published to Project Files"
            : "Moved in Project Files",
        );
        await onFilesChanged?.();
      }
      setLocationDialog({ open: false, nodes: [], targetFolderId: null, mode: "move" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "File operation failed";
      toast.error(message);
      throw error;
    }
  }, [canManageFiles, locationDialog, onFilesChanged, projectId]);

  const handleToggle = useCallback(
    async (node: ProjectNode) => {
      if (node.type !== "folder") return;

      const isExpanded = !!expandedFolderIds[node.id];
      const nextExpanded = !isExpanded;
      setExpandedFolderIds((prev) => ({ ...prev, [node.id]: nextExpanded }));

      if (nextExpanded && !loadedChildren[node.id]) {
        setLoadingFolders((prev) => ({ ...prev, [node.id]: true }));
        try {
          const res = await getProjectNodes(projectId, node.id, undefined, 100, undefined, { taskId });
          const nodes = res.nodes;
          setLoadedChildren((prev) => ({ ...prev, [node.id]: nodes }));
          setChildCursors((prev) => ({ ...prev, [node.id]: res.nextCursor }));
        } catch (e) {
          console.error("Failed to load folder children", e);
        } finally {
          setLoadingFolders((prev) => ({ ...prev, [node.id]: false }));
        }
      }
    },
    [expandedFolderIds, loadedChildren, projectId],
  );

  const loadMoreChildren = useCallback(async (folderId: string) => {
    const cursor = childCursors[folderId];
    if (!cursor || loadingFolders[folderId]) return;
    setLoadingFolders((prev) => ({ ...prev, [folderId]: true }));
    try {
      const res = await getProjectNodes(projectId, folderId, undefined, 100, cursor, { taskId });
      setLoadedChildren((prev) => ({
        ...prev,
        [folderId]: [...(prev[folderId] ?? []), ...res.nodes],
      }));
      setChildCursors((prev) => ({ ...prev, [folderId]: res.nextCursor }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load more files");
    } finally {
      setLoadingFolders((prev) => ({ ...prev, [folderId]: false }));
    }
  }, [childCursors, loadingFolders, projectId]);

  const handleAnnotationChange = useCallback(
    async (nodeId: string, val: string | null) => {
      const value = val ? val.trim() : null;
      try {
        await updateTaskNodeLink(taskId, nodeId, { annotation: value });
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Failed to save annotation";
        toast.error(message);
      }
    },
    [taskId],
  );

  const handleTagChange = useCallback(
    async (nodeId: string, newTags: string[]) => {
      try {
        await updateTaskNodeLink(taskId, nodeId, { tags: newTags });
        await onFilesChanged?.();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to save tags";
        toast.error(message);
      }
    },
    [onFilesChanged, taskId],
  );

  const handleMoveToDeliverables = useCallback(
    (node: ProjectNode) => {
      void handleTagChange(
        node.id,
        replaceTaskFileRoleTag((node as LinkedTaskNode).tags, "deliverable"),
      );
    },
    [handleTagChange],
  );

  const handleMoveToWorkingFiles = useCallback(
    (node: ProjectNode) => {
      void handleTagChange(
        node.id,
        replaceTaskFileRoleTag((node as LinkedTaskNode).tags, "working"),
      );
    },
    [handleTagChange],
  );

  const handleMoveToReferences = useCallback(
    (node: ProjectNode) => {
      void handleTagChange(
        node.id,
        replaceTaskFileRoleTag((node as LinkedTaskNode).tags, "reference"),
      );
    },
    [handleTagChange],
  );

  const isDeliverableNode = (node: LinkedTaskNode) =>
    inferTaskFileRole(node) === "deliverable";

  const deliverableRoots = useMemo(() => {
    return linkedNodes
      .filter((n) => isDeliverableNode(n))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [linkedNodes]);

  const referenceRoots = useMemo(() => {
    return linkedNodes
      .filter((n) => inferTaskFileRole(n) === "reference")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [linkedNodes]);

  const workingRoots = useMemo(() => {
    return linkedNodes
      .filter((n) => inferTaskFileRole(n) === "working")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [linkedNodes]);

  const renderNodeList = (
    nodes: LinkedTaskNode[],
    level: number,
    role: TaskFileRole,
  ) => {
    return (
      <div className="flex flex-col gap-0.5">
        {nodes.map((node) => {
          const isExpanded = !!expandedFolderIds[node.id];
          const isLoading = !!loadingFolders[node.id];
          const children = loadedChildren[node.id] || [];

          return (
            <React.Fragment key={`${node.id}-${level}`}>
              <div style={{ paddingLeft: `${level * 20}px` }}>
                <TaskFileRow
                  node={node}
                  canEdit={canEdit}
                  canManageFiles={canManageFiles}
                  isExpanded={isExpanded}
                  onToggleExpanded={handleToggle}
                  onOpen={(n) => {
                    if (n.type === "folder") {
                      handleToggle(n);
                    } else {
                      onOpenFile?.(n);
                    }
                  }}
                  onShowHistory={
                    onShowHistory ? (n) => onShowHistory(n) : undefined
                  }
                  onUnlink={
                    level === 0 && onUnlink ? (n) => onUnlink(n.id) : undefined
                  }
                  onReplaceWithNewVersion={onReplaceWithNewVersion}
                  isDeliverable={role === "deliverable"}
                  fileRole={role}
                  onMoveToDeliverables={
                    level === 0 ? handleMoveToDeliverables : undefined
                  }
                  onMoveToWorkingFiles={
                    level === 0 ? handleMoveToWorkingFiles : undefined
                  }
                  onMoveToReferences={
                    level === 0 ? handleMoveToReferences : undefined
                  }
                  onLabelChange={(n, newLabel) => {
                    const nextAnnotation = composeAnnotation(
                      newLabel,
                      (n as any).annotation,
                    );
                    void handleAnnotationChange(n.id, nextAnnotation || "");
                  }}
                  onMoveInProjectFiles={(selectedNode) =>
                    setLocationDialog({
                      open: true,
                      nodes: [selectedNode],
                      targetFolderId: selectedNode.parentId ?? null,
                      mode: "move",
                    })
                  }
                  onPublishToProjectFiles={(selectedNode) =>
                    setLocationDialog({
                      open: true,
                      nodes: [selectedNode],
                      targetFolderId: null,
                      mode: "publish",
                    })
                  }
                  isHighlighted={node.id === highlightedNodeId}
                />
              </div>
              {isExpanded && isLoading && (
                <div
                  className="flex items-center gap-2 py-2 pl-8 text-xs text-zinc-500"
                  style={{ paddingLeft: `${16 + (level + 1) * 20}px` }}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </div>
              )}
              {isExpanded &&
                children.length > 0 &&
                renderNodeList(
                  children as LinkedTaskNode[],
                  level + 1,
                  role,
                )}
              {isExpanded && childCursors[node.id] && (
                <button
                  type="button"
                  onClick={() => void loadMoreChildren(node.id)}
                  className="ml-8 mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  style={{ marginLeft: `${16 + (level + 1) * 20}px` }}
                >
                  Load more
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col space-y-8 pb-10">
      <div className="flex flex-col">
        <div className="mb-3 px-2">
          <h3 className="text-xs font-semibold tracking-wider text-zinc-900 dark:text-zinc-100">
            Task References
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Files supplied with the task brief or explicitly linked as context.
          </p>
        </div>
        <div data-testid="task-files-list-references" className="flex flex-col gap-2">
          {referenceRoots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 py-6 text-center text-[11px] font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-500">
              No task references attached.
            </div>
          ) : (
            renderNodeList(referenceRoots, 0, "reference")
          )}
        </div>
      </div>

      {/* Deliverables Section */}
      <div className="flex flex-col">
        <div className="mb-3 px-2">
          <h3 className="text-xs font-semibold tracking-wider text-zinc-900 dark:text-zinc-100">
            Final Deliverables
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            The finished output resolving this task.
          </p>
        </div>
        <div
          data-testid="task-files-list-deliverables"
          className="flex flex-col gap-2"
        >
          {deliverableRoots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 py-6 text-center text-[11px] font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-500">
              No final deliverables confirmed yet.
            </div>
          ) : (
            renderNodeList(deliverableRoots, 0, "deliverable")
          )}
        </div>
      </div>

      {/* Active task work */}
      <div className="flex flex-col">
        <div className="mb-3 px-2 mt-4">
          <h3 className="text-xs font-semibold tracking-wider text-zinc-900 dark:text-zinc-100">
            {TASK_WORKING_FILES_TITLE}
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Drafts and active assets used while completing this task.
          </p>
        </div>
        <div
          data-testid="task-files-list-working"
          className="flex flex-col gap-2"
        >
          {workingRoots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 py-6 text-center text-[11px] font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-500">
              No working files attached.
            </div>
          ) : (
            renderNodeList(workingRoots, 0, "working")
          )}
        </div>
      </div>
      <MoveDialog
        moveDialog={locationDialog}
        setMoveDialog={(next) =>
          setLocationDialog((current) => {
            const resolved = typeof next === "function" ? next(current) : next;
            return { ...resolved, mode: current.mode };
          })
        }
        confirmMove={confirmLocationChange}
        canEdit={canManageFiles}
        projectId={projectId}
        mode={locationDialog.mode}
      />
    </div>
  );
}
