import { useCallback, useEffect, useRef, useState } from "react";
import { getTaskLinkCounts } from "@/app/actions/files/links";

import {
  getProjectNodesWithCounts,
  getProjectNodes,
  getProjectBatchNodes,
  
  getProjectTreeFlat,
  initializeProjectWorkspaceRoot,
} from "@/app/actions/files/nodes";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ProjectNode } from "@/lib/db/schema";
import { filesFeatureFlags } from "@/lib/features/files";
import { getErrorMessage } from "./explorerTypes";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { recordFilesMetric } from "@/lib/files/observability";

const EMPTY_OBJ: Record<string, boolean> = {};


export function useExplorerBoot(options: {
  projectId: string;
  canEdit: boolean;
  isActive: boolean;
  syncStatus?: string;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { projectId, canEdit, isActive, syncStatus, showToast } = options;

  const [isBooting, setIsBooting] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  const expandedFolderIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJ
  );
  const loadedChildren = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJ
  );

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const setNodesAndChildren = useFilesWorkspaceStore((s) => s.setNodesAndChildren);
  const markChildrenLoaded = useFilesWorkspaceStore((s) => s.markChildrenLoaded);
  const setFolderMeta = useFilesWorkspaceStore((s) => s.setFolderMeta);
  const setTaskLinkCounts = useFilesWorkspaceStore((s) => s.setTaskLinkCounts);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const batchUpdateStore = useFilesWorkspaceStore((s) => s.batchUpdateStore);

  const bootedRef = useRef(false);
  const batchLoadedRef = useRef(false);
  const folderLoadInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const prefetchedFolderKeysRef = useRef<Set<string>>(new Set());
  const isActiveRef = useRef(isActive);
  const expandedFolderIdsRef = useRef(expandedFolderIds);

  useEffect(() => {
    expandedFolderIdsRef.current = expandedFolderIds;
  }, [expandedFolderIds]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const loadFolderContent = useCallback(
    async (parentId: string | null, mode: "refresh" | "append" = "append") => {
      if (!isActiveRef.current) return;
      const requestKey = `${filesParentKey(parentId)}::${mode}`;
      const inFlight = folderLoadInFlightRef.current.get(requestKey);
      if (inFlight) {
        await inFlight;
        return;
      }
      if (
        folderLoadInFlightRef.current.size >=
        FILES_RUNTIME_BUDGETS.maxInFlightFolderRequests
      ) {
        if (mode === "append") {
          showToast("Folder loading is busy. Please try again.", "info");
        }
        return;
      }

      const task = (async () => {
        const startedAt = performance.now();
        try {
          const parentKey = filesParentKey(parentId);
          const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];

          let cursor: string | undefined = undefined;
          const limit = 100;

          if (mode === "append") {
            const meta = currentWs?.folderMeta?.[parentKey];
            cursor = meta?.nextCursor || undefined;
            if (!cursor) return;
          }

          setAccessError(null);

          let newNodes: ProjectNode[] = [];
          let nextCursor: string | null = null;
          let taskCounts: Record<string, number> | null = null;

          if (filesFeatureFlags.storeBatching || filesFeatureFlags.wave2StoreBatching) {
            const payload = await getProjectNodesWithCounts(
              projectId,
              parentId,
              undefined,
              limit,
              cursor
            );
            if (!payload.success) {
              throw new Error(payload.message || "Failed to load files");
            }
            newNodes = payload.data.nodes;
            nextCursor = payload.data.nextCursor;
            taskCounts = payload.data.taskLinkCounts;
          } else {
            const res = (await getProjectNodes(
              projectId,
              parentId,
              undefined,
              limit,
              cursor
            )) as {
              nodes: ProjectNode[];
              nextCursor: string | null;
            };
            newNodes = Array.isArray(res) ? res : res.nodes;
            nextCursor = !Array.isArray(res) ? res.nextCursor : null;
            if (newNodes.length > 0) {
              upsertNodes(projectId, newNodes);
            }
          }

          if (!isActiveRef.current) return;

          const latestWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
          const currentChildrenIds = latestWs?.childrenByParentId?.[parentKey] || [];
          const mergedChildIds =
            mode === "refresh"
              ? newNodes.map((n) => n.id)
              : Array.from(new Set([...currentChildrenIds, ...newNodes.map((n) => n.id)]));

          setNodesAndChildren(projectId, newNodes, parentId, mergedChildIds, {
            nextCursor,
            hasMore: !!nextCursor,
            loaded: true,
          });

          if (mode === "refresh" && nextCursor && parentId && expandedFolderIdsRef.current[parentId]) {
            const prefetchKey = filesParentKey(parentId);
            if (!prefetchedFolderKeysRef.current.has(prefetchKey)) {
              prefetchedFolderKeysRef.current.add(prefetchKey);
              queueMicrotask(() => {
                if (!isActiveRef.current) return;
                void loadFolderContent(parentId, "append");
              });
            }
          }

          if (taskCounts) {
            setTaskLinkCounts(projectId, taskCounts);
          } else {
            const fileIds = newNodes.filter((n) => n.type === "file").map((n) => n.id);
            if (fileIds.length > 0) {
              const counts = await getTaskLinkCounts(projectId, fileIds);
              setTaskLinkCounts(projectId, counts);
            }
          }
        } catch (e: unknown) {
          console.error("Load folder failed", e);
          if (mode === "refresh") {
            setAccessError(getErrorMessage(e, "Failed to load files"));
          } else {
            showToast("Failed to load more files", "error");
          }
        } finally {
          const elapsedMs = Math.round(performance.now() - startedAt);
          recordFilesMetric("files.folder.load.latency_ms", {
            projectId,
            value: elapsedMs,
            extra: {
              parentId: parentId ?? "root",
              mode,
              inFlight: folderLoadInFlightRef.current.size,
            },
          });
          if (process.env.NODE_ENV !== "production") {
            console.debug("[files] loadFolderContent", {
              projectId,
              parentId: parentId ?? "root",
              mode,
              elapsedMs,
            });
          }
          folderLoadInFlightRef.current.delete(requestKey);
        }
      })();

      folderLoadInFlightRef.current.set(requestKey, task);
      await task;
    },
    [projectId, setNodesAndChildren, setTaskLinkCounts, showToast, upsertNodes]
  );

  // 1. Root Boot (Initial Load)
  const boot = useCallback(async () => {
    if (!isActiveRef.current) {
      setIsBooting(false);
      return;
    }
    const key = filesParentKey(null);
    const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
    const alreadyLoaded = currentWs?.loadedChildren?.[key];

    if (!bootedRef.current && !alreadyLoaded) {
      bootedRef.current = true;

      try {
        // Fetch flat tree and root directory content concurrently to minimize roundtrips
        const [flatTreeResult, rootFolderResult] = await Promise.all([
          getProjectTreeFlat(projectId, {
            maxNodes: FILES_RUNTIME_BUDGETS.maxFlatTreeBootNodes,
          }).catch((err) => {
            console.error("Flat tree boot pre-fetch failed, falling back", err);
            return { nodes: [], isComplete: false };
          }),
          (filesFeatureFlags.storeBatching || filesFeatureFlags.wave2StoreBatching)
            ? getProjectNodesWithCounts(projectId, null, undefined, 100).catch((err) => {
                console.error("Root directory boot pre-fetch failed", err);
                return { success: false as const, message: String(err) };
              })
            : getProjectNodes(projectId, null, undefined, 100).catch((err) => {
                console.error("Root directory boot pre-fetch failed", err);
                return { nodes: [], nextCursor: null };
              })
        ]);

        if (!isActiveRef.current) return;

        const { nodes: allNodes, isComplete } = flatTreeResult;

        if (isComplete && allNodes && allNodes.length > 0) {
          const grouped: Record<string, string[]> = {};
          allNodes.forEach(n => {
            const parentKey = filesParentKey(n.parentId);
            if (!grouped[parentKey]) grouped[parentKey] = [];
            grouped[parentKey].push(n.id);
          });

          const payloads = Object.entries(grouped).map(([parentKey, childIds]) => {
            const pid = parentKey === "__root__" ? null : parentKey;
            const dedupedChildIds = Array.from(new Set(childIds));
            return {
              parentId: pid,
              childIds: dedupedChildIds,
              nextCursor: null,
              hasMore: false,
              loaded: true
            };
          });

          // Also mark root as loaded if it was empty
          if (!grouped["__root__"]) {
            payloads.push({
              parentId: null,
              childIds: [],
              nextCursor: null,
              hasMore: false,
              loaded: true
            });
          }

          batchUpdateStore(projectId, payloads, allNodes);

          // Fetch task link counts for all loaded files (Req 7.1)
          const fileIds = allNodes.filter((n) => n.type === "file").map((n) => n.id);
          if (fileIds.length > 0) {
            const counts = await getTaskLinkCounts(projectId, fileIds);
            setTaskLinkCounts(projectId, counts);
          }
        } else {
          // Provisioning is an explicit command so directory reads remain side-effect free.
          // Only initialize the workspace root if the project is small and actually empty (isComplete is true).
          // If isComplete is false, it means the project has > maxFlatTreeBootNodes files, so it's definitely not empty!
          if (isComplete && canEdit) {
            await initializeProjectWorkspaceRoot(projectId);
            await loadFolderContent(null, "refresh");
          } else {
            // Apply pre-fetched root folder results directly to save a request
            if ('success' in rootFolderResult) {
              if (rootFolderResult.success && rootFolderResult.data) {
                const { nodes: newNodes, nextCursor, taskLinkCounts } = rootFolderResult.data;
                const mergedChildIds = newNodes.map((n) => n.id);
                setNodesAndChildren(projectId, newNodes, null, mergedChildIds, {
                  nextCursor,
                  hasMore: !!nextCursor,
                  loaded: true,
                });
                if (taskLinkCounts) {
                  setTaskLinkCounts(projectId, taskLinkCounts);
                }
              } else {
                await loadFolderContent(null, "refresh");
              }
            } else {
              const res = rootFolderResult as { nodes: ProjectNode[]; nextCursor: string | null } | ProjectNode[];
              const newNodes = Array.isArray(res) ? res : res.nodes;
              const nextCursor = !Array.isArray(res) ? res.nextCursor : null;

              if (newNodes.length > 0) {
                upsertNodes(projectId, newNodes);
              }
              const mergedChildIds = newNodes.map((n) => n.id);
              setNodesAndChildren(projectId, newNodes, null, mergedChildIds, {
                nextCursor,
                hasMore: !!nextCursor,
                loaded: true,
              });
              const fileIds = newNodes.filter((n) => n.type === "file").map((n) => n.id);
              if (fileIds.length > 0) {
                const counts = await getTaskLinkCounts(projectId, fileIds);
                setTaskLinkCounts(projectId, counts);
              }
            }
          }
        }
      } catch (e) {
        console.error("Flat tree load failed, falling back to paginated loader", e);
        if (!isActiveRef.current) return;
        await loadFolderContent(null, "refresh");
      }

      if (!isActiveRef.current) return;

      const updatedWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      const rootChildren = updatedWs?.childrenByParentId[filesParentKey(null)] || [];
      if (rootChildren.length === 1) {
        const rootId = rootChildren[0];
        const rootNode = updatedWs?.nodesById[rootId!];
        if (
          rootNode &&
          typeof rootNode.metadata === "object" &&
          rootNode.metadata !== null &&
          (rootNode.metadata as Record<string, unknown>).isSystem === true &&
          rootNode.type === "folder"
        ) {
          toggleExpanded(projectId, rootNode.id, true);
        }
      }

      setIsBooting(false);
    } else {
      setIsBooting(false);
    }
  }, [canEdit, projectId, loadFolderContent, toggleExpanded, setNodesAndChildren, setTaskLinkCounts, upsertNodes, batchUpdateStore]);

  useEffect(() => {
    if (!isActive) return;
    void boot();
  }, [boot, isActive]);

  // Auto-refresh when sync finishes (GitHub import)
  const prevSyncStatus = useRef(syncStatus);
  useEffect(() => {
    if (!isActive) return;
    const wasSyncing =
      prevSyncStatus.current === "pending" ||
      prevSyncStatus.current === "cloning" ||
      prevSyncStatus.current === "indexing";
    if (!isBooting && wasSyncing && syncStatus === "ready") {
      console.log("Sync finished, refreshing file explorer...");
      void loadFolderContent(null, "refresh");
    }
    prevSyncStatus.current = syncStatus;
  }, [isActive, isBooting, syncStatus, loadFolderContent]);

  // 2. Batch Hydration (Session Restore)
  useEffect(() => {
    if (!isActive) return;
    if (batchLoadedRef.current) return;
    const currentExpanded =
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.expandedFolderIds || {};
    const foldersToLoad = Object.keys(currentExpanded).filter((id) => !!currentExpanded[id]);

    if (foldersToLoad.length === 0) {
      batchLoadedRef.current = true;
      return;
    }

    batchLoadedRef.current = true;

    void (async () => {
      try {
        const parents = foldersToLoad.map((id) => (id === "root" ? null : id));

        const allNodes = (await getProjectBatchNodes(projectId, parents)) as ProjectNode[];
        if (!isActiveRef.current) return;

        const grouped: Record<string, ProjectNode[]> = {};
        parents.forEach((p) => (grouped[filesParentKey(p)] = []));

        allNodes.forEach((node) => {
          const key = filesParentKey(node.parentId);
          if (grouped[key]) grouped[key].push(node);
        });

        upsertNodes(projectId, allNodes);

        Object.entries(grouped).forEach(([key, children]) => {
          const pid = key === "__root__" ? null : key;
          const uniqueChildIds = Array.from(new Set(children.map((n) => n.id)));
          setChildren(
            projectId,
            pid,
            uniqueChildIds
          );
          markChildrenLoaded(projectId, pid);
          setFolderMeta(projectId, pid, { nextCursor: null, hasMore: false });
        });

        // Fetch task link counts for all loaded files (Req 7.1)
        const fileIds = allNodes.filter((n) => n.type === "file").map((n) => n.id);
        if (fileIds.length > 0) {
          const counts = await getTaskLinkCounts(projectId, fileIds);
          setTaskLinkCounts(projectId, counts);
        }
      } catch (e) {
        console.error("Batch hydration failed", e);
      }
    })();
  }, [isActive, projectId, upsertNodes, setChildren, markChildrenLoaded, setFolderMeta, setTaskLinkCounts]);

  // 3. User Interaction Expansion (Lazy Load)
  const handleToggleFolder = useCallback(
    async (node: ProjectNode) => {
      if (node.type !== "folder") return;
      const next = !expandedFolderIds[node.id];
      toggleExpanded(projectId, node.id, next);

      if (next) {
        const key = filesParentKey(node.id);
        const loaded = loadedChildren[key];
        if (!loaded) {
          await loadFolderContent(node.id, "refresh");
        }
      }
    },
    [expandedFolderIds, toggleExpanded, projectId, loadedChildren, loadFolderContent]
  );

  const handleLoadMore = useCallback(
    (folderId: string | null) => {
      void loadFolderContent(folderId, "append");
    },
    [loadFolderContent]
  );

  return {
    isBooting,
    accessError,
    setAccessError,
    loadFolderContent,
    handleToggleFolder,
    handleLoadMore,
  };
}
