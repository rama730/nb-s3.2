import { useCallback, useEffect } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { acquireProjectNodeLock, releaseProjectNodeLock, getProjectLocks } from "@/app/actions/files";
import { clearOfflineChange, listOfflineChanges } from "../hooks/useFilesOfflineQueue";
import { recordFilesMetric } from "@/lib/files/observability";
import { get, set } from "idb-keyval";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { createClient } from "@/lib/supabase/client";

type NodeLockResult = {
  ok: boolean;
  lock?: {
    lockedBy: string;
    lockedByName?: string | null;
    expiresAt: number;
  };
};

interface UseWorkspaceLifecycleOptions {
  projectId: string;
  canEdit: boolean;
  initialFileNodes?: ProjectNode[];
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  ensureNodeMetadata: (nodeIds: string[]) => Promise<void>;
  saveContentDirect: (
    node: ProjectNode,
    content: string,
    opts?: { silent?: boolean; reason?: string }
  ) => Promise<boolean>;
}

export function useWorkspaceLifecycle({
  projectId,
  canEdit,
  initialFileNodes,
  showToast,
  ensureNodeMetadata,
  saveContentDirect,
}: UseWorkspaceLifecycleOptions) {
  const ensureProjectWorkspace = useFilesWorkspaceStore((s) => s.ensureProjectWorkspace);
  const setNodes = useFilesWorkspaceStore((s) => s.setNodes);
  const setFolderPayload = useFilesWorkspaceStore((s) => s.setFolderPayload);

  const hydrateFromIdb = useFilesWorkspaceStore((s) => s.hydrateFromIdb);

  useEffect(() => {
    ensureProjectWorkspace(projectId);

    // Pure Data Handling: Instant Hydration from IndexedDB Disk
    const hydrateLocalCache = async () => {
      try {
        const cacheKey = `nb-s3-workspace-${projectId}`;
        const cached = await get<{ nodesById: Record<string, ProjectNode>, childrenByParentId: Record<string, string[]> }>(cacheKey);

        if (cached && Object.keys(cached.nodesById).length > 0 && hydrateFromIdb) {
          hydrateFromIdb(projectId, cached.nodesById, cached.childrenByParentId);
        }
      } catch (e) {
        console.warn("Failed to hydrate from IDB", e);
      }
    };

    if (initialFileNodes && initialFileNodes.length > 0) {
      const current =
        useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById;
      if (!current || Object.keys(current).length === 0) {

        // Try injecting Local IDB first for Zero-Latency painting
        hydrateLocalCache().then(() => {
          // Then fall back/merge with server initial Nodes
          setNodes(projectId, initialFileNodes);
          const rootChildIds = initialFileNodes
            .filter((node) => node.parentId === null)
            .map((node) => node.id);
          setFolderPayload(projectId, null, {
            childIds: rootChildIds,
            nextCursor: null,
            hasMore: false,
            loaded: true,
          });
        });
      }
    } else {
      hydrateLocalCache();
    }

    // Initial Lock Hydration: Ensure all existing locks are known instantly
    const fetchLocks = async () => {
      try {
        const locks = await getProjectLocks(projectId);
        const store = useFilesWorkspaceStore.getState();
        locks.forEach(lock => store.setLock(projectId, lock));
      } catch (e) {
        console.warn("Failed to fetch initial locks", e);
      }
    };
    fetchLocks();

    // Phase 4: Extreme Enterprise Scale - Pure Data Fetching (Supabase Multiplayer Delta-Patching)
    const supabase = createClient();

    let realtimeBuffer: ProjectNode[] = [];
    let deleteBuffer: string[] = [];
    let realtimeTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushRealtime = () => {
      const store = useFilesWorkspaceStore.getState();
      if (realtimeBuffer.length > 0) {
        store.upsertNodes(projectId, realtimeBuffer);
        realtimeBuffer = [];
      }
      if (deleteBuffer.length > 0) {
        deleteBuffer.forEach(id => store.removeNodeFromCaches(projectId, id));
        deleteBuffer = [];
      }
      realtimeTimeout = null;
    };

    const realtimeChannel = supabase.channel(`public:project_nodes:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_nodes',
          filter: `project_id=eq.${projectId}`
        },
        (payload: any) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            realtimeBuffer.push(payload.new as ProjectNode);
          } else if (payload.eventType === 'DELETE') {
            deleteBuffer.push(payload.old.id);
          }

          if (!realtimeTimeout) {
            realtimeTimeout = setTimeout(flushRealtime, 250);
          }
        }
      )
      .subscribe();

    const locksChannel = supabase.channel(`public:project_node_locks:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_node_locks',
          filter: `project_id=eq.${projectId}`
        },
        (payload: any) => {
          const store = useFilesWorkspaceStore.getState();
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            store.setLock(projectId, {
              nodeId: payload.new.node_id,
              projectId: payload.new.project_id,
              lockedBy: payload.new.locked_by,
              expiresAt: new Date(payload.new.expires_at).getTime(),
            });
          } else if (payload.eventType === 'DELETE') {
            store.clearLock(projectId, payload.old.node_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
      supabase.removeChannel(locksChannel);
    };

  }, [ensureProjectWorkspace, projectId, initialFileNodes, setFolderPayload, setNodes, hydrateFromIdb]);

  const flushOfflineQueue = useCallback(async () => {
    if (!canEdit) return;
    if (typeof navigator === "undefined" || !navigator.onLine) return;

    try {
      const queueEntries = listOfflineChanges(projectId);
      const queue = Object.fromEntries(queueEntries) as Record<
        string,
        { content: string; ts: number }
      >;
      const nodeIds = queueEntries.map(([nodeId]) => nodeId);
      if (nodeIds.length === 0) return;

      showToast(`Syncing ${nodeIds.length} offline changes...`, "info");

      await ensureNodeMetadata(nodeIds);
      const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      if (!currentWs) return;

      let synced = 0;
      const nextQueue: Record<string, { content: string; ts: number }> = {
        ...queue,
      };
      await runWithConcurrency(nodeIds, FILES_RUNTIME_BUDGETS.saveAllConcurrency, async (nodeId) => {
        const node = currentWs.nodesById[nodeId];
        if (!node?.s3Key) return;

        try {
          const lockRes = (await acquireProjectNodeLock(
            projectId,
            nodeId,
            120
          )) as NodeLockResult;
          if (!lockRes.ok) return;

          const ok = await saveContentDirect(node, queue[nodeId].content, {
            silent: true,
            reason: "offline-flush",
          });
          if (ok) {
            delete nextQueue[nodeId];
            synced += 1;
            recordFilesMetric("files.offline.flush.success_count", {
              projectId,
              nodeId,
              value: 1,
            });
          } else {
            recordFilesMetric("files.offline.flush.failure_count", {
              projectId,
              nodeId,
              value: 1,
            });
          }
        } catch (e) {
          console.error("Offline sync failed for node", nodeId, e);
          recordFilesMetric("files.offline.flush.failure_count", {
            projectId,
            nodeId,
            value: 1,
          });
        } finally {
          try {
            await releaseProjectNodeLock(projectId, nodeId);
          } catch { }
        }
      });

      for (const nodeId of nodeIds) {
        if (!(nodeId in nextQueue)) {
          clearOfflineChange(projectId, nodeId);
        }
      }

      if (synced > 0) {
        showToast(`Synced ${synced} files from offline session`, "success");
      }
    } catch (e) {
      console.error("Offline sync failed", e);
    }
  }, [canEdit, projectId, ensureNodeMetadata, showToast, saveContentDirect]);

  useEffect(() => {
    const onOnline = () => {
      void flushOfflineQueue();
    };

    window.addEventListener("online", onOnline);
    void flushOfflineQueue();

    return () => window.removeEventListener("online", onOnline);
  }, [flushOfflineQueue]);
}
