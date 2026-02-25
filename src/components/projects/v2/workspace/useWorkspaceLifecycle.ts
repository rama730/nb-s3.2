import { useCallback, useEffect } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { acquireProjectNodeLock, releaseProjectNodeLock } from "@/app/actions/files";
import { clearOfflineChange, listOfflineChanges } from "../hooks/useFilesOfflineQueue";
import { recordFilesMetric } from "@/lib/files/observability";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";

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

  useEffect(() => {
    ensureProjectWorkspace(projectId);
    if (initialFileNodes && initialFileNodes.length > 0) {
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
    }
  }, [ensureProjectWorkspace, projectId, initialFileNodes, setFolderPayload, setNodes]);

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
          } catch {}
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
