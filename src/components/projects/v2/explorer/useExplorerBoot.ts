import { useCallback, useEffect, useRef, useState } from "react";
import { getTaskLinkCounts } from "@/app/actions/files/links";

import {
  getProjectNodesWithCounts,
  getProjectNodes,
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
  const setNodesAndChildren = useFilesWorkspaceStore((s) => s.setNodesAndChildren);
  const setTaskLinkCounts = useFilesWorkspaceStore((s) => s.setTaskLinkCounts);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);

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
    batchLoadedRef.current = false;
  }, [projectId]);

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
      while (
        folderLoadInFlightRef.current.size >=
        FILES_RUNTIME_BUDGETS.maxInFlightFolderRequests
      ) {
        // Queue behind active reads; a saturated prefetch queue is not a
        // successful empty response. Recheck after every released slot.
        await Promise.race(folderLoadInFlightRef.current.values()).catch(() => {});
        if (!isActiveRef.current) return;
        const queued = folderLoadInFlightRef.current.get(requestKey);
        if (queued) return await queued;
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
            newNodes = res.nodes;
            nextCursor = res.nextCursor;
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
                void loadFolderContent(parentId, "append").catch(() => {});
              });
            }
          }

          if (taskCounts) {
            setTaskLinkCounts(projectId, taskCounts);
          }
        } catch (e: unknown) {
          console.error("Load folder failed", e);
          if (mode === "refresh") {
            setAccessError(getErrorMessage(e, "Failed to load files"));
          } else {
            showToast("Failed to load more files", "error");
          }
          throw e;
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

      await loadFolderContent(null, "refresh");
      if (!isActiveRef.current) return;

      const rootAfterLoad = useFilesWorkspaceStore.getState()
        .byProjectId[projectId]?.childrenByParentId[filesParentKey(null)] ?? [];
      if (rootAfterLoad.length === 0 && canEdit) {
        const createdRoot = await initializeProjectWorkspaceRoot(projectId);
        if (createdRoot) await loadFolderContent(null, "refresh");
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
  }, [canEdit, projectId, loadFolderContent, toggleExpanded]);

  useEffect(() => {
    if (!isActive) return;
    void boot().catch(() => setIsBooting(false));
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
      void loadFolderContent(null, "refresh").catch(() => {});
    }
    prevSyncStatus.current = syncStatus;
  }, [isActive, isBooting, syncStatus, loadFolderContent]);

  // ponytail: restore only unloaded folders through paginated loader without forced refresh cascades.
  // Four requests at a time keeps restore below the global in-flight budget.
  useEffect(() => {
    if (!isActive || batchLoadedRef.current) return;
    batchLoadedRef.current = true;
    const ws = useFilesWorkspaceStore.getState().byProjectId[projectId];
    const expanded = ws?.expandedFolderIds ?? {};
    const loaded = ws?.loadedChildren ?? {};
    const ids = Object.keys(expanded).filter(id => expanded[id] && !loaded[filesParentKey(id === "root" ? null : id)]);
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      for (let offset = 0; offset < ids.length && !cancelled; offset += 4) {
        await Promise.allSettled(ids.slice(offset, offset + 4).map(id => loadFolderContent(id === "root" ? null : id, "append")));
      }
    })();
    return () => { cancelled = true; };
  }, [isActive, projectId, loadFolderContent]);

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
          await loadFolderContent(node.id, "refresh").catch(() => {});
        }
      }
    },
    [expandedFolderIds, toggleExpanded, projectId, loadedChildren, loadFolderContent]
  );

  const handleLoadMore = useCallback(
    (folderId: string | null) => {
      void loadFolderContent(folderId, "append").catch(() => {});
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
