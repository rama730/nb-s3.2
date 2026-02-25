import { useCallback } from "react";
import { bulkMoveNodes } from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ProjectNode } from "@/lib/db/schema";
import { getErrorMessage, type ExplorerOperation } from "./explorerTypes";

export function useExplorerDragDrop(options: {
  projectId: string;
  canEdit: boolean;
  nodesById: Record<string, ProjectNode>;
  storeSelectedNodeIds: string[];
  runUniqueMutation: <T>(key: string, fn: () => Promise<T>) => Promise<T | null>;
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  loadFolderContent: (parentId: string | null, mode: "refresh" | "append") => Promise<void>;
  toggleExpanded: (projectId: string, nodeId: string, expanded: boolean) => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
  recordOperation: (op: Omit<ExplorerOperation, "id" | "at">) => void;
}) {
  const {
    projectId,
    canEdit,
    nodesById,
    storeSelectedNodeIds,
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast,
    recordOperation,
  } = options;

  const handleDropOnFolder = useCallback(
    async (folderId: string, draggedId: string) => {
      if (!canEdit) return;
      if (folderId === draggedId) return;

      let nodesToMove: string[] = [draggedId];
      if (storeSelectedNodeIds.includes(draggedId)) {
        nodesToMove = [...storeSelectedNodeIds];
      }

      nodesToMove = nodesToMove.filter((id) => id !== folderId);
      if (nodesToMove.length === 0) return;

      const sortedIds = [...nodesToMove].sort();
      const mutationKey = `drop-move:${projectId}:${folderId}:${sortedIds.join(",")}`;

      try {
        const result = await runUniqueMutation(mutationKey, async () => {
          const staleParents = new Set<string | null>();
          for (const id of nodesToMove) {
            const oldParentId = nodesById[id]?.parentId ?? null;
            if (oldParentId !== folderId) staleParents.add(oldParentId);
          }

          const updatedNodes = (await bulkMoveNodes(
            sortedIds,
            folderId,
            projectId
          )) as ProjectNode[];
          if (updatedNodes.length > 0) upsertNodes(projectId, updatedNodes);

          if (updatedNodes.length > 0) {
            await Promise.all(
              Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh"))
            );
            await loadFolderContent(folderId, "refresh");
            toggleExpanded(projectId, folderId, true);
          }
          return updatedNodes.length;
        });

        if (result === null || result === 0) return;
        showToast(`Moved ${result} item${result === 1 ? "" : "s"}`, "success");
        recordOperation({
          label: `Dragged ${result} item${result === 1 ? "" : "s"} to folder`,
          status: "success",
        });
      } catch (e: unknown) {
        showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
        recordOperation({
          label: "Drag move failed",
          status: "error",
        });
      }
    },
    [
      canEdit,
      storeSelectedNodeIds,
      nodesById,
      projectId,
      runUniqueMutation,
      upsertNodes,
      loadFolderContent,
      toggleExpanded,
      showToast,
      recordOperation,
    ]
  );

  return { handleDropOnFolder };
}
