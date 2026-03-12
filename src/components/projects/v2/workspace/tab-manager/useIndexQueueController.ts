import { useCallback, useRef } from "react";
import { upsertProjectFileIndex } from "@/app/actions/files";
import { recordFilesMetric } from "@/lib/files/observability";
import {
  createInitialIndexQueueState,
  getIndexQueueConcurrency,
  updateIndexQueueRuntimeState,
} from "../indexQueueRuntime";

interface UseIndexQueueControllerOptions {
  projectId: string;
}

export function useIndexQueueController({ projectId }: UseIndexQueueControllerOptions) {
  const indexQueueRef = useRef<string[]>([]);
  const queuedNodeIdsRef = useRef<Set<string>>(new Set());
  const activeNodeIdsRef = useRef<Set<string>>(new Set());
  const pendingContentByNodeRef = useRef<Map<string, string>>(new Map());
  const activeIndexJobsRef = useRef(0);
  const pumpScheduledRef = useRef(false);
  const indexQueueRuntimeStateRef = useRef(createInitialIndexQueueState());

  const pumpIndexQueue = useCallback(() => {
    const schedulePump = () => {
      if (pumpScheduledRef.current) return;
      pumpScheduledRef.current = true;
      queueMicrotask(() => {
        pumpScheduledRef.current = false;
        runPump();
      });
    };

    const runPump = () => {
      const targetConcurrency = getIndexQueueConcurrency(
        indexQueueRef.current.length,
        indexQueueRuntimeStateRef.current
      );
      const maxStartsThisTick = Math.max(1, targetConcurrency * 2);
      let started = 0;
      while (
        activeIndexJobsRef.current < targetConcurrency &&
        indexQueueRef.current.length > 0 &&
        started < maxStartsThisTick
      ) {
        const nodeId = indexQueueRef.current.shift();
        if (!nodeId) break;
        const content = pendingContentByNodeRef.current.get(nodeId);
        if (typeof content !== "string") {
          queuedNodeIdsRef.current.delete(nodeId);
          console.warn("Index queue: skipping nodeId with missing content", {
            projectId,
            nodeId,
          });
          continue;
        }
        queuedNodeIdsRef.current.delete(nodeId);

        started += 1;
        activeIndexJobsRef.current += 1;
        activeNodeIdsRef.current.add(nodeId);
        const startedAt = performance.now();
        void upsertProjectFileIndex(projectId, nodeId, content)
          .then(() => {
            updateIndexQueueRuntimeState(indexQueueRuntimeStateRef.current, {
              latencyMs: performance.now() - startedAt,
              success: true,
            });
          })
          .catch((error) => {
            updateIndexQueueRuntimeState(indexQueueRuntimeStateRef.current, {
              latencyMs: performance.now() - startedAt,
              success: false,
            });
            console.warn("Index queue job failed", {
              projectId,
              nodeId,
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            activeIndexJobsRef.current -= 1;
            activeNodeIdsRef.current.delete(nodeId);
            const latest = pendingContentByNodeRef.current.get(nodeId);
            if (latest !== content && !queuedNodeIdsRef.current.has(nodeId)) {
              queuedNodeIdsRef.current.add(nodeId);
              indexQueueRef.current.push(nodeId);
            } else if (latest === content) {
              pendingContentByNodeRef.current.delete(nodeId);
            }
            schedulePump();
          });
      }
    };

    schedulePump();
  }, [projectId]);

  const enqueueIndexUpdate = useCallback(
    (nodeId: string, content: string) => {
      pendingContentByNodeRef.current.set(nodeId, content);
      if (!queuedNodeIdsRef.current.has(nodeId) && !activeNodeIdsRef.current.has(nodeId)) {
        queuedNodeIdsRef.current.add(nodeId);
        indexQueueRef.current.push(nodeId);
      }
      recordFilesMetric("files.index.queue.depth", {
        projectId,
        nodeId,
        value: indexQueueRef.current.length,
      });
      pumpIndexQueue();
    },
    [projectId, pumpIndexQueue]
  );

  return {
    enqueueIndexUpdate,
  };
}
