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
  const indexQueueRef = useRef<Array<() => Promise<void>>>([]);
  const activeIndexJobsRef = useRef(0);
  const indexQueueRuntimeStateRef = useRef(createInitialIndexQueueState());

  const pumpIndexQueue = useCallback(() => {
    const run = () => {
      const targetConcurrency = getIndexQueueConcurrency(
        indexQueueRef.current.length,
        indexQueueRuntimeStateRef.current
      );
      while (
        activeIndexJobsRef.current < targetConcurrency &&
        indexQueueRef.current.length > 0
      ) {
        const job = indexQueueRef.current.shift();
        if (!job) break;
        activeIndexJobsRef.current += 1;
        const startedAt = performance.now();
        void job()
          .then(() => {
            updateIndexQueueRuntimeState(indexQueueRuntimeStateRef.current, {
              latencyMs: performance.now() - startedAt,
              success: true,
            });
          })
          .catch(() => {
            updateIndexQueueRuntimeState(indexQueueRuntimeStateRef.current, {
              latencyMs: performance.now() - startedAt,
              success: false,
            });
          })
          .finally(() => {
            activeIndexJobsRef.current -= 1;
            run();
          });
      }
    };
    run();
  }, []);

  const enqueueIndexUpdate = useCallback(
    (nodeId: string, content: string) => {
      indexQueueRef.current.push(async () => {
        try {
          await upsertProjectFileIndex(projectId, nodeId, content);
        } catch {}
      });
      recordFilesMetric("files.index.queue.depth", {
        projectId,
        nodeId,
        value: indexQueueRef.current.length,
      });
      pumpIndexQueue();
    },
    [projectId]
  );

  return {
    enqueueIndexUpdate,
  };
}
