import { useCallback, useRef } from "react";
import { upsertProjectFileIndex } from "@/app/actions/files";
import {
  createInitialIndexQueueState,
  getIndexQueueConcurrency,
  updateIndexQueueRuntimeState,
} from "../workspace/indexQueueRuntime";
import { recordFilesMetric } from "@/lib/files/observability";

export function useFileIndexQueue(projectId: string) {
  const queueRef = useRef<Array<() => Promise<void>>>([]);
  const activeJobsRef = useRef(0);
  const runtimeStateRef = useRef(createInitialIndexQueueState());

  const pump = useCallback(() => {
    const launchNextJob = () => {
      const targetConcurrency = getIndexQueueConcurrency(
        queueRef.current.length,
        runtimeStateRef.current
      );
      if (activeJobsRef.current >= targetConcurrency) return;
      const job = queueRef.current.shift();
      if (!job) return;
      activeJobsRef.current += 1;
      const startedAt = performance.now();
      void job()
        .then(() => {
          updateIndexQueueRuntimeState(runtimeStateRef.current, {
            latencyMs: performance.now() - startedAt,
            success: true,
          });
        })
        .catch(() => {
          updateIndexQueueRuntimeState(runtimeStateRef.current, {
            latencyMs: performance.now() - startedAt,
            success: false,
          });
        })
        .finally(() => {
          activeJobsRef.current -= 1;
          launchNextJob();
        });
    };

    const targetConcurrency = getIndexQueueConcurrency(
      queueRef.current.length,
      runtimeStateRef.current
    );
    while (activeJobsRef.current < targetConcurrency && queueRef.current.length > 0) {
      launchNextJob();
    }
  }, []);

  const enqueue = useCallback(
    (nodeId: string, content: string) => {
      queueRef.current.push(async () => {
        try {
          await upsertProjectFileIndex(projectId, nodeId, content);
        } catch {
          // best-effort
        }
      });
      recordFilesMetric("files.index.queue.depth", {
        projectId,
        nodeId,
        value: queueRef.current.length,
      });
      pump();
    },
    [projectId, pump]
  );

  return { enqueueIndexUpdate: enqueue };
}
