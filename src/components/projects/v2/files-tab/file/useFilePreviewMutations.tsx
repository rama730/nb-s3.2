"use client";

import { useContext } from "react";
import { toast } from "sonner";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useExplorerMutations } from "../../explorer/useExplorerMutations";
import { useExplorerOperationLog } from "../../explorer/useExplorerOperationLog";
import { ExplorerDialogsHost } from "../../explorer/ExplorerDialogsHost";
import { FilesTabBootContext } from "../hooks/useFolderContents";
import { useNavigateTo } from "../hooks/useNavigateTo";

const EMPTY = {};
const EMPTY_IDS: string[] = [];

/** Reuse the list's mutation/Undo/dialog implementation in the file preview. */
export function useFilePreviewMutations(
  projectId: string,
  nodeId: string | undefined,
  canEdit: boolean,
  canManageFiles: boolean,
) {
  const ws = useFilesWorkspaceStore((state) => state.byProjectId[projectId]);
  const state = useFilesWorkspaceStore.getState();
  const boot = useContext(FilesTabBootContext);
  const navigateTo = useNavigateTo(projectId);
  const { recordOperation } = useExplorerOperationLog();
  const node = nodeId ? (ws?.nodesById[nodeId] ?? null) : null;
  const mutations = useExplorerMutations({
    projectId,
    canEdit: canEdit && !!node && !!boot,
    canManageFiles,
    selectedNode: node,
    selectedFolderId: node?.parentId ?? null,
    nodesById: ws?.nodesById ?? EMPTY,
    childrenByParentId: ws?.childrenByParentId ?? EMPTY,
    loadedChildren: ws?.loadedChildren ?? EMPTY,
    // Preview actions always target this file, not a stale list selection.
    storeSelectedNodeIds: EMPTY_IDS,
    upsertNodes: state.upsertNodes,
    setChildren: state.setChildren,
    toggleExpanded: state.toggleExpanded,
    setSelectedNode: state.setSelectedNode,
    setSelectedNodeIds: state.setSelectedNodeIds,
    loadFolderContent: boot?.loadFolderContent ?? (async () => {}),
    onOpenFile: (node) => navigateTo(node.id),
    showToast: (message, type = "info") => toast[type](message),
    recordOperation,
  });
  return {
    node,
    mutations,
    dialogs: (
      <ExplorerDialogsHost
        {...mutations}
        canEdit={canEdit && !!node && !!boot}
        canManageFiles={canManageFiles}
        projectId={projectId}
        confirmCreate={async () => {
          await mutations.confirmCreate();
        }}
        confirmRename={async () => {
          await mutations.confirmRename();
        }}
        confirmDelete={async () => {
          await mutations.confirmDelete();
        }}
        confirmMove={async () => {
          await mutations.confirmMove();
        }}
      />
    ),
  };
}
