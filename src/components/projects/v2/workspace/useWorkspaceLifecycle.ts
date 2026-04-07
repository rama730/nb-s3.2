import { useCallback, useEffect, useRef } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { acquireProjectNodeLock, releaseProjectNodeLock, getProjectLocks } from "@/app/actions/files";
import { clearOfflineChange, listOfflineChanges } from "../hooks/useFilesOfflineQueue";
import { recordFilesMetric } from "@/lib/files/observability";
import { get } from "idb-keyval";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { createClient } from "@/lib/supabase/client";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { logger } from "@/lib/logger";

const hydratedProjectLocks = new Set<string>();
const projectLockHydrationInFlight = new Set<string>();
const FALLBACK_LOCK_TTL = 120_000;

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
  isActive: boolean;
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
  isActive,
  initialFileNodes,
  showToast,
  ensureNodeMetadata,
  saveContentDirect,
}: UseWorkspaceLifecycleOptions) {
  const isActiveRef = useRef(isActive);
  const ensureProjectWorkspace = useFilesWorkspaceStore((s) => s.ensureProjectWorkspace);
  const setNodes = useFilesWorkspaceStore((s) => s.setNodes);
  const setFolderPayload = useFilesWorkspaceStore((s) => s.setFolderPayload);

  const hydrateFromIdb = useFilesWorkspaceStore((s) => s.hydrateFromIdb);
  const pruneGhostTabs = useFilesWorkspaceStore((s) => s.pruneGhostTabs);
  const pruneDeadExpanded = useFilesWorkspaceStore((s) => s.pruneDeadExpanded);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

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
        logger.warn("Failed to hydrate from IDB", { module: "workspace", error: e instanceof Error ? e.message : String(e) });
      }
    };

    let cancelled = false;

    void (async () => {
      // Try injecting Local IDB first for Zero-Latency painting
      await hydrateLocalCache();
      if (cancelled) return;

      if (initialFileNodes && initialFileNodes.length > 0) {
        // Re-check store state after async hydration to avoid overwriting
        // realtime data that arrived during IDB hydration
        const current =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById;
        if (!current || Object.keys(current).length === 0) {
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
        }
        // FW8: Remove tabs referencing deleted nodes after hydration
        pruneGhostTabs(projectId);
        // FW9: Prune expandedFolderIds for deleted folders
        pruneDeadExpanded(projectId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensureProjectWorkspace, projectId, initialFileNodes, setFolderPayload, setNodes, hydrateFromIdb, pruneGhostTabs, pruneDeadExpanded]);

  useEffect(() => {
    if (!isActive) return;
    if (hydratedProjectLocks.has(projectId) || projectLockHydrationInFlight.has(projectId)) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (
        cancelled ||
        !isActiveRef.current ||
        hydratedProjectLocks.has(projectId) ||
        projectLockHydrationInFlight.has(projectId)
      ) {
        return;
      }

      projectLockHydrationInFlight.add(projectId);
      void (async () => {
        try {
          const locks = await getProjectLocks(projectId);
          if (cancelled || !isActiveRef.current) return;
          const store = useFilesWorkspaceStore.getState();
          locks.forEach((lock) => store.setLock(projectId, lock));
          hydratedProjectLocks.add(projectId);
        } catch (e) {
          logger.warn("Failed to fetch initial locks", {
            module: "workspace",
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          projectLockHydrationInFlight.delete(projectId);
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      projectLockHydrationInFlight.delete(projectId);
    };
  }, [isActive, projectId]);

  useEffect(() => {
    if (!isActive) return;

    const supabase = createClient();
    let realtimeBuffer: ProjectNode[] = [];
    let deleteBuffer: string[] = [];
    let realtimeTimeout: ReturnType<typeof setTimeout> | null = null;
    const REALTIME_BUFFER_CAP = 500;

    const flushRealtime = () => {
      const store = useFilesWorkspaceStore.getState();
      if (realtimeBuffer.length > 0) {
        store.upsertNodes(projectId, realtimeBuffer);
        realtimeBuffer = [];
      }
      if (deleteBuffer.length > 0) {
        deleteBuffer.forEach((id) => store.removeNodeFromCaches(projectId, id));
        deleteBuffer = [];
      }
      realtimeTimeout = null;
    };

    const workspaceChannel = subscribeActiveResource({
      supabase,
      resourceType: "workspace",
      resourceId: `files:${projectId}`,
      bindings: [
        {
          event: "*",
          table: "project_nodes",
          filter: `project_id=eq.${projectId}`,
          handler: (payload) => {
            const previousRow = (payload.old ?? null) as Record<string, unknown> | null;
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              realtimeBuffer.push(payload.new as ProjectNode);
            } else if (payload.eventType === "DELETE") {
              const deletedId = typeof previousRow?.id === "string" ? previousRow.id : null;
              if (deletedId) {
                deleteBuffer.push(deletedId);
              }
            }

            if (realtimeBuffer.length + deleteBuffer.length >= REALTIME_BUFFER_CAP) {
              if (realtimeTimeout) {
                clearTimeout(realtimeTimeout);
                realtimeTimeout = null;
              }
              flushRealtime();
            } else if (!realtimeTimeout) {
              realtimeTimeout = setTimeout(flushRealtime, 250);
            }
          },
        },
        {
          event: "*",
          table: "project_node_locks",
          filter: `project_id=eq.${projectId}`,
          handler: (payload) => {
            const store = useFilesWorkspaceStore.getState();
            const nextRow = (payload.new ?? null) as Record<string, unknown> | null;
            const previousRow = (payload.old ?? null) as Record<string, unknown> | null;

            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              const nodeId = String(nextRow?.node_id || "");
              const lockedBy = String(nextRow?.locked_by || "");
              if (!nodeId) {
                logger.warn("Received lock event with missing node_id", {
                  module: "workspace",
                  projectId,
                  nodeId,
                  eventType: payload.eventType,
                });
                return;
              }
              const rawExpiresAt = nextRow?.expires_at;
              const parsedExpiresAt = rawExpiresAt
                ? new Date(rawExpiresAt as string | number).getTime()
                : Number.NaN;
              const expiresAt = Number.isFinite(parsedExpiresAt)
                ? parsedExpiresAt
                : Date.now() + FALLBACK_LOCK_TTL;

              if (!Number.isFinite(parsedExpiresAt)) {
                logger.warn("Received project node lock without a valid expiry", {
                  module: "workspace",
                  projectId,
                  nodeId,
                  lockedBy,
                  rawExpiresAt: rawExpiresAt ?? null,
                });
              }

              store.setLock(projectId, {
                nodeId,
                projectId: String(nextRow?.project_id || ""),
                lockedBy,
                expiresAt,
              });
              store.setLastNodeEventSummary(projectId, nodeId, {
                type: "lock_acquire",
                at: Date.now(),
                by: store.byProjectId[projectId]?.locksByNodeId[nodeId]?.lockedByName ?? null,
              });
            } else if (payload.eventType === "DELETE" && typeof previousRow?.node_id === "string") {
              store.clearLock(projectId, previousRow.node_id);
              store.setLastNodeEventSummary(projectId, previousRow.node_id, {
                type: "lock_release",
                at: Date.now(),
                by: null,
              });
            }
          },
        },
      ],
    });

    return () => {
      if (realtimeTimeout) clearTimeout(realtimeTimeout);
      supabase.removeChannel(workspaceChannel);
    };
  }, [isActive, projectId]);

  const flushOfflineQueue = useCallback(async () => {
    if (!canEdit || !isActive) return;
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
          } catch (error) {
            logger.warn("Failed to release project node lock", { module: "workspace", projectId, nodeId, error: error instanceof Error ? error.message : String(error) });
          }
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
  }, [canEdit, ensureNodeMetadata, isActive, projectId, saveContentDirect, showToast]);

  useEffect(() => {
    if (!isActive) return;
    const onOnline = () => {
      void flushOfflineQueue();
    };

    window.addEventListener("online", onOnline);
    void flushOfflineQueue();

    return () => window.removeEventListener("online", onOnline);
  }, [flushOfflineQueue, isActive]);
}
