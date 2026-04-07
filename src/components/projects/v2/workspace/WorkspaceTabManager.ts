import { useEffect, useMemo } from "react";
import type React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { isAssetLike, isTextLike } from "../utils/fileKind";
import { useIndexQueueController } from "./tab-manager/useIndexQueueController";
import { useTabDnD } from "./tab-manager/useTabDnD";
import { useTabMetadataPipeline } from "./tab-manager/useTabMetadataPipeline";
import { useTabContentLoader } from "./tab-manager/useTabContentLoader";
import { useTabSavePipeline } from "./tab-manager/useTabSavePipeline";

const DEFAULT_NODES: Record<string, ProjectNode> = {};

export interface UseTabManagerOptions {
  projectId: string;
  currentUserId?: string;
  isActive: boolean;
  canEdit: boolean;
  viewMode: FilesViewMode;
  activePane: PaneId;
  setActivePane: (p: PaneId) => void;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  tabById: Record<string, FilesWorkspaceTabState>;
  setTabById: React.Dispatch<React.SetStateAction<Record<string, FilesWorkspaceTabState>>>;
  tabByIdRef: React.MutableRefObject<Record<string, FilesWorkspaceTabState>>;
  acquireLockForNode: (node: ProjectNode) => Promise<void>;
  nextLockAttemptAtRef: React.MutableRefObject<Map<string, number>>;
  leftOpenTabIds: string[];
  rightOpenTabIds: string[];
  leftOpenTabIdsKey: string;
  rightOpenTabIdsKey: string;
  setRecentFileIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useTabManager({
  projectId,
  isActive,
  canEdit,
  viewMode,
  activePane,
  setActivePane,
  showToast,
  tabById,
  setTabById,
  tabByIdRef,
  acquireLockForNode,
  nextLockAttemptAtRef,
  leftOpenTabIds,
  rightOpenTabIds,
  leftOpenTabIdsKey,
  rightOpenTabIdsKey,
  setRecentFileIds,
}: UseTabManagerOptions) {
  const openTab = useFilesWorkspaceStore((s) => s.openTab);
  const closeTabStore = useFilesWorkspaceStore((s) => s.closeTab);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setFileState = useFilesWorkspaceStore((s) => s.setFileState);
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const clearLock = useFilesWorkspaceStore((s) => s.clearLock);
  const removeNodeFromCaches = useFilesWorkspaceStore((s) => s.removeNodeFromCaches);
  const setLastNodeEventSummary = useFilesWorkspaceStore((s) => s.setLastNodeEventSummary);
  const reorderTabs = useFilesWorkspaceStore((s) => s.reorderTabs);
  const moveTabToPane = useFilesWorkspaceStore((s) => s.moveTabToPane);
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById || DEFAULT_NODES
  );

  const { enqueueIndexUpdate } = useIndexQueueController({ projectId });

  const { sensors, handleDragEnd } = useTabDnD({
    projectId,
    reorderTabs,
    moveTabToPane,
  });

  const {
    opsInProgressRef,
    signedUrlCacheRef,
    ensureNodeMetadata,
    ensureSignedUrlForNode,
  } = useTabMetadataPipeline({
    projectId,
    upsertNodes,
  });

  const { loadFileContent } = useTabContentLoader({
    projectId,
    ensureSignedUrlForNode,
    opsInProgressRef,
    setFileState,
    setTabById,
  });

  const fileNodes = useMemo(
    () => Object.values(nodesById).filter((node) => node?.type === "file"),
    [nodesById]
  );

  const dirtyTabIds = useMemo(
    () =>
      Object.values(tabById)
        .filter((tab) => tab.isDirty)
        .map((tab) => tab.id),
    [tabById]
  );

  const nodePathById = useMemo(() => {
    const cache = new Map<string, string>();
    const resolve = (nodeId: string): string => {
      const cached = cache.get(nodeId);
      if (cached) return cached;
      const node = nodesById[nodeId];
      if (!node) return "";
      if (!node.parentId) {
        cache.set(nodeId, node.name);
        return node.name;
      }
      const path = `${resolve(node.parentId)}/${node.name}`;
      cache.set(nodeId, path);
      return path;
    };
    for (const node of Object.values(nodesById)) {
      if (node?.id) resolve(node.id);
    }
    return cache;
  }, [nodesById]);

  const {
    conflictDialog,
    setConflictDialog,
    saveTab,
    saveContentDirect,
    openFileInPane,
    closeTab,
    deleteFile,
    handleSaveAllDirtyTabs,
  } = useTabSavePipeline({
    projectId,
    canEdit,
    showToast,
    setTabById,
    tabByIdRef,
    nextLockAttemptAtRef,
    storeActions: {
      setFileState,
      upsertNodes,
      clearLock,
      removeNodeFromCaches,
      setLastNodeEventSummary,
    },
    viewMode,
    activePane,
    setActivePane,
    openTab,
    closeTabStore,
    setSelectedNode,
    acquireLockForNode,
    loadFileContent,
    ensureSignedUrlForNode,
    signedUrlCacheRef,
    enqueueIndexUpdate,
    dirtyTabIds,
    nodesById,
    setRecentFileIds,
  });

  // Tab restoration: ensure metadata + content for persisted tabs (chunked to prevent OOM)
  useEffect(() => {
    if (!isActive) return;
    const allOpenIds = Array.from(new Set([...leftOpenTabIds, ...rightOpenTabIds]));
    if (allOpenIds.length === 0) return;

    const controller = new AbortController();
    const RESTORE_CHUNK_SIZE = 10;
    const restoreTimer = setTimeout(() => {
      void (async () => {
        // Chunk metadata fetching to avoid burst of requests
        for (let i = 0; i < allOpenIds.length; i += RESTORE_CHUNK_SIZE) {
          if (controller.signal.aborted) return;
          const chunk = allOpenIds.slice(i, i + RESTORE_CHUNK_SIZE);
          await ensureNodeMetadata(chunk);
        }

        if (controller.signal.aborted) return;
        const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
        if (!currentWs) return;

        for (const id of allOpenIds) {
          if (controller.signal.aborted) return;
          const node = currentWs.nodesById[id];
          if (!node) continue;

          if (!tabByIdRef.current[id]) {
            setTabById((prev) => ({
              ...prev,
              [id]: {
                id,
                node,
                content: "",
                contentVersion: 0,
                savedSnapshot: "",
                savedSnapshotVersion: 0,
                isDirty: false,
                isLoading: true,
                isSaving: false,
                isDeleting: false,
                hasLock: false,
                lockInfo: null,
                offlineQueued: false,
                error: null,
                assetUrl: null,
                assetUrlExpiresAt: null,
              },
            }));
            const wantsPreview =
              isAssetLike(node) &&
              (viewMode === "assets" ||
                viewMode === "all" ||
                (viewMode === "code" && !isTextLike(node)));
            if (wantsPreview) {
              try {
                const url = await ensureSignedUrlForNode(node);
                if (controller.signal.aborted) return;
                const exp = signedUrlCacheRef.current.get(node.id)?.expiresAt ?? null;
                setTabById((prev) => ({
                  ...prev,
                  [id]: {
                    ...prev[id],
                    isLoading: false,
                    assetUrl: url,
                    assetUrlExpiresAt: exp,
                  },
                }));
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Failed to load preview";
                if (controller.signal.aborted) return;
                setTabById((prev) => ({
                  ...prev,
                  [id]: {
                    ...prev[id],
                    isLoading: false,
                    error: message,
                  },
                }));
              }
            } else {
              await loadFileContent(node);
            }
          }
        }
      })();
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(restoreTimer);
    };
  }, [
    ensureNodeMetadata,
    ensureSignedUrlForNode,
    isActive,
    leftOpenTabIds,
    leftOpenTabIdsKey,
    loadFileContent,
    projectId,
    rightOpenTabIds,
    rightOpenTabIdsKey,
    signedUrlCacheRef,
    tabByIdRef,
    setTabById,
    viewMode,
  ]);

  return {
    conflictDialog,
    setConflictDialog,
    dirtyTabIds,
    fileNodes,
    nodePathById,
    nodesById,
    sensors,
    handleDragEnd,
    openFileInPane,
    closeTab,
    deleteFile,
    saveTab,
    saveContentDirect,
    loadFileContent,
    ensureNodeMetadata,
    ensureSignedUrlForNode,
    handleSaveAllDirtyTabs,
  };
}
