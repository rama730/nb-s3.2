import { useCallback, useEffect, useRef } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import {
  acquireProjectNodeLock,
  refreshProjectNodeLock,
} from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { recordFilesMetric } from "@/lib/files/observability";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

const LOCK_RETRY_FALLBACK_MS = 5_000;
const LOCK_RETRY_MIN_DELAY_MS = 1_000;
const LOCK_RETRY_EXPIRY_BUFFER_MS = 250;

type NodeLockResult = {
  ok: boolean;
  lock?: {
    lockedBy: string;
    lockedByName?: string | null;
    expiresAt: number;
  };
};

interface UseLockManagerOptions {
  projectId: string;
  currentUserId?: string;
  canEdit: boolean;
  panesToRender: PaneId[];
  activeTabIdByPane: Record<PaneId, string | null>;
  tabByIdRef: React.RefObject<Record<string, FilesWorkspaceTabState>>;
  setTabById: React.Dispatch<React.SetStateAction<Record<string, FilesWorkspaceTabState>>>;
  leftActiveTabId: string | null | undefined;
  rightActiveTabId: string | null | undefined;
  leftOpenTabIds: string[];
  rightOpenTabIds: string[];
  leftOpenTabIdsKey: string;
  rightOpenTabIdsKey: string;
}

export function useLockManager({
  projectId,
  currentUserId,
  canEdit,
  panesToRender,
  activeTabIdByPane,
  tabByIdRef,
  setTabById,
  leftActiveTabId,
  rightActiveTabId,
  leftOpenTabIds,
  rightOpenTabIds,
  leftOpenTabIdsKey,
  rightOpenTabIdsKey,
}: UseLockManagerOptions) {
  const setLock = useFilesWorkspaceStore((s) => s.setLock);
  const clearLock = useFilesWorkspaceStore((s) => s.clearLock);
  const nextLockAttemptAtRef = useRef<Map<string, number>>(new Map());

  const scheduleNextLockAttempt = useCallback(
    (nodeId: string, lockExpiresAt?: number | null) => {
      const now = Date.now();
      const nextAttemptAt =
        typeof lockExpiresAt === "number" && Number.isFinite(lockExpiresAt)
          ? Math.max(now + LOCK_RETRY_MIN_DELAY_MS, lockExpiresAt + LOCK_RETRY_EXPIRY_BUFFER_MS)
          : now + LOCK_RETRY_FALLBACK_MS;
      nextLockAttemptAtRef.current.set(nodeId, nextAttemptAt);
    },
    []
  );

  const clearLockAttemptSchedule = useCallback((nodeId: string) => {
    nextLockAttemptAtRef.current.delete(nodeId);
  }, []);

  const acquireLockForNode = useCallback(
    async (node: ProjectNode) => {
      if (!currentUserId) return;
      const startedAt = performance.now();
      try {
        const res = (await acquireProjectNodeLock(projectId, node.id, 120)) as NodeLockResult;
        if (res.ok) {
          clearLockAttemptSchedule(node.id);
          setTabById((prev) => ({
            ...prev,
            [node.id]: { ...prev[node.id], hasLock: true, lockInfo: null },
          }));
          clearLock(projectId, node.id);
          recordFilesMetric("files.lock.acquire_ms", {
            projectId,
            nodeId: node.id,
            value: Math.round(performance.now() - startedAt),
          });
        } else {
          const lock = res.lock;
          if (!lock) {
            scheduleNextLockAttempt(node.id);
            setTabById((prev) => ({
              ...prev,
              [node.id]: { ...prev[node.id], hasLock: false },
            }));
            recordFilesMetric("files.lock.conflict_count", {
              projectId,
              nodeId: node.id,
              value: 1,
              extra: { reason: "unknown_lock_holder" },
            });
            return;
          }
          scheduleNextLockAttempt(node.id, lock.expiresAt);
          setTabById((prev) => ({
            ...prev,
            [node.id]: { ...prev[node.id], hasLock: false, lockInfo: lock },
          }));
          setLock(projectId, {
            nodeId: node.id,
            lockedBy: lock.lockedBy,
            lockedByName: lock.lockedByName ?? null,
            expiresAt: lock.expiresAt,
          });
          recordFilesMetric("files.lock.conflict_count", {
            projectId,
            nodeId: node.id,
            value: 1,
            extra: { reason: "held_by_other" },
          });
        }
      } catch {
        scheduleNextLockAttempt(node.id);
        setTabById((prev) => ({
          ...prev,
          [node.id]: { ...prev[node.id], hasLock: false },
        }));
        recordFilesMetric("files.lock.conflict_count", {
          projectId,
          nodeId: node.id,
          value: 1,
          extra: { reason: "lock_error" },
        });
      }
    },
    [clearLock, clearLockAttemptSchedule, currentUserId, projectId, scheduleNextLockAttempt, setLock, setTabById]
  );

  const tryAcquireActivePaneLocks = useCallback(() => {
    if (!currentUserId || !canEdit) return;
    const now = Date.now();
    for (const paneId of panesToRender) {
      const id = activeTabIdByPane[paneId];
      if (!id) continue;
      const tab = tabByIdRef.current[id];
      if (!tab || tab.hasLock) continue;
      const nextAttemptAt = nextLockAttemptAtRef.current.get(id) || 0;
      if (nextAttemptAt > now) continue;
      void acquireLockForNode(tab.node);
    }
  }, [acquireLockForNode, activeTabIdByPane, canEdit, currentUserId, panesToRender, tabByIdRef]);

  // Attempt lock acquisition immediately when active tabs change
  useEffect(() => {
    tryAcquireActivePaneLocks();
  }, [tryAcquireActivePaneLocks]);

  // Polling for lock retry
  useEffect(() => {
    if (!currentUserId || !canEdit) return;
    const cleanup = createVisibilityAwareInterval(() => {
      tryAcquireActivePaneLocks();
    }, 3_000);
    return cleanup;
  }, [canEdit, currentUserId, tryAcquireActivePaneLocks]);

  // Clean up stale lock attempt schedules for closed tabs
  useEffect(() => {
    const openTabIds = new Set([...leftOpenTabIds, ...rightOpenTabIds]);
    for (const nodeId of Array.from(nextLockAttemptAtRef.current.keys())) {
      if (!openTabIds.has(nodeId)) {
        nextLockAttemptAtRef.current.delete(nodeId);
      }
    }
  }, [leftOpenTabIds, rightOpenTabIds, leftOpenTabIdsKey, rightOpenTabIdsKey]);

  // Refresh lock TTL for active tabs
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      timer = setTimeout(() => {
        if (cancelled) return;
        tick();
      }, delayMs);
    };

    const tick = () => {
      const activeIds = new Set<string>();
      for (const paneId of panesToRender) {
        const id = activeTabIdByPane[paneId];
        if (id) activeIds.add(id);
      }
      for (const id of activeIds) {
        const tab = tabByIdRef.current[id];
        if (!tab?.hasLock) continue;
        void refreshProjectNodeLock(projectId, id, 120);
      }
      const nextDelay = document.hidden ? 180_000 : 60_000;
      schedule(nextDelay);
    };

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (!document.hidden) {
        tick();
      }
    };

    schedule(0);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeTabIdByPane, currentUserId, panesToRender, projectId, leftActiveTabId, rightActiveTabId]);

  return {
    acquireLockForNode,
    nextLockAttemptAtRef,
  };
}
