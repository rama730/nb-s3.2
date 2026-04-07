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
const LOCK_RETRY_EXPIRY_BUFFER_MS = 5_000;
const EMPTY_LOCKS = {} as Record<
  string,
  { lockedBy: string; lockedByName?: string | null; expiresAt: number }
>;

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
  currentUserDisplayName?: string | null;
  isActive: boolean;
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
  currentUserDisplayName,
  isActive,
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
  const mountedRef = useRef(true);
  const setLock = useFilesWorkspaceStore((s) => s.setLock);
  const clearLock = useFilesWorkspaceStore((s) => s.clearLock);
  const setLastNodeEventSummary = useFilesWorkspaceStore((s) => s.setLastNodeEventSummary);
  const nextLockAttemptAtRef = useRef<Map<string, number>>(new Map());
  const acquiringNodesRef = useRef<Set<string>>(new Set());

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
      if (!currentUserId || !isActive || acquiringNodesRef.current.has(node.id)) return;
      const startedAt = performance.now();

      try {
        // Pure Optimization: O(1) Optimistic Local Locking
        // Bypass the Supabase REST API latency for instant UI feedback.
        clearLockAttemptSchedule(node.id);
        setTabById((prev) => {
          const current = prev[node.id];
          if (!current) return prev;
          return {
            ...prev,
            [node.id]: {
              ...current,
              hasLock: true,
              lockInfo: {
                lockedBy: currentUserId,
                lockedByName: currentUserDisplayName ?? null,
                expiresAt: Date.now() + 120_000,
              },
            },
          };
        });
        clearLock(projectId, node.id);

        // Phase 5 Trace: Follow-up with background server-side acquisition
        // This ensures the lock is actually established on the server.
        acquiringNodesRef.current.add(node.id);
        void (async () => {
          try {
            const res = await acquireProjectNodeLock(projectId, node.id, 120) as NodeLockResult;
            if (res.ok && res.lock) {
              const confirmedLock = res.lock;
              // Background confirm - update TTL and info
              if (!mountedRef.current) return;
              setTabById((prev) => {
                const current = prev[node.id];
                if (!current || !current.hasLock) return prev; // already lost or changed
                return {
                  ...prev,
                  [node.id]: {
                    ...current,
                    lockInfo: {
                      ...confirmedLock,
                      lockedByName: currentUserDisplayName ?? confirmedLock.lockedByName ?? null,
                    },
                  },
                };
              });
              setLock(projectId, {
                nodeId: node.id,
                projectId,
                lockedBy: confirmedLock.lockedBy,
                lockedByName: currentUserDisplayName ?? confirmedLock.lockedByName ?? null,
                expiresAt: confirmedLock.expiresAt,
              });
              setLastNodeEventSummary(projectId, node.id, {
                type: "lock_acquire",
                at: Date.now(),
                by: currentUserDisplayName ?? confirmedLock.lockedByName ?? null,
              });
              recordFilesMetric("files.lock.acquire_ms", {
                projectId,
                nodeId: node.id,
                value: Math.round(performance.now() - startedAt),
              });
            } else if (!res.ok && res.lock) {
              // Conflict detected after optimistic update - revert to server state
              // Pure Optimization: Backoff retry logic to prevent infinite render loops
              scheduleNextLockAttempt(node.id, res.lock.expiresAt);
              if (!mountedRef.current) return;
              setTabById((prev) => {
                const current = prev[node.id];
                if (!current) return prev;
                return {
                  ...prev,
                  [node.id]: { ...current, hasLock: false, lockInfo: res.lock ?? null },
                };
              });
              setLock(projectId, {
                nodeId: node.id,
                projectId,
                lockedBy: res.lock.lockedBy,
                lockedByName: res.lock.lockedByName,
                expiresAt: res.lock.expiresAt,
              });
            } else {
              // Unknown failure (e.g. network/auth) - revert optimistic lock slowly
              scheduleNextLockAttempt(node.id);
              if (!mountedRef.current) return;
              setTabById((prev) => {
                const current = prev[node.id];
                if (!current) return prev;
                return {
                  ...prev,
                  [node.id]: { ...current, hasLock: false, lockInfo: null },
                };
              });
            }
          } catch (e) {
            console.error("Delayed lock acquisition failed", e);
            scheduleNextLockAttempt(node.id);
          } finally {
            acquiringNodesRef.current.delete(node.id);
          }
        })();
      } catch {
        scheduleNextLockAttempt(node.id);
        setTabById((prev) => {
          const current = prev[node.id];
          if (!current) return prev;
          return {
            ...prev,
            [node.id]: { ...current, hasLock: false, lockInfo: null },
          };
        });
        recordFilesMetric("files.lock.conflict_count", {
          projectId,
          nodeId: node.id,
          value: 1,
          extra: { reason: "lock_error" },
        });
      }
    },
    [
      clearLock,
      clearLockAttemptSchedule,
      currentUserDisplayName,
      currentUserId,
      isActive,
      projectId,
      scheduleNextLockAttempt,
      setLastNodeEventSummary,
      setLock,
      setTabById,
    ]
  );

  const tryAcquireActivePaneLocks = useCallback(() => {
    if (!currentUserId || !canEdit || !isActive) return;
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
  }, [acquireLockForNode, activeTabIdByPane, canEdit, currentUserId, isActive, panesToRender, tabByIdRef]);

  // Phase 5: Global Lock Sync (React 19 Pure Sync Pattern)
  // Listen to the store's locks and synchronize with the tab state in real-time.
  const locksForSync = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.locksByNodeId ?? EMPTY_LOCKS
  );
  useEffect(() => {
    const tabIds = Object.keys(tabByIdRef.current);
    if (!tabIds.length) return;

    setTabById((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const id of tabIds) {
        const tab = prev[id];
        if (!tab) continue;

        const serverLock = locksForSync[id];
        // If server has a lock and it's not held by us, OR if server has NO lock but we THINK we do.
        // Exceptions: if we are in the middle of an acquisition (hasLock: true but lockInfo: null), we wait.
        const isHeldByUsLocally = tab.hasLock;
        const isHeldByOthersOnServer = serverLock && serverLock.lockedBy !== currentUserId;
        const isNoneOnServer = !serverLock;

        if (isHeldByOthersOnServer) {
          if (tab.hasLock || tab.lockInfo?.lockedBy !== serverLock.lockedBy) {
            next[id] = { ...tab, hasLock: false, lockInfo: serverLock };
            changed = true;
          }
        } else if (isNoneOnServer && tab.hasLock && tab.lockInfo) {
          // We think we hold the lock with confirmed server info, but server says it's gone (expired/evicted)
          next[id] = { ...tab, hasLock: false, lockInfo: null };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [locksForSync, currentUserId, setTabById, tabByIdRef]);

  // Track mount state for async callback guards
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Attempt lock acquisition immediately when active tabs change
  useEffect(() => {
    if (!isActive) return;
    tryAcquireActivePaneLocks();
  }, [isActive, tryAcquireActivePaneLocks]);

  // Polling for lock retry
  useEffect(() => {
    if (!currentUserId || !canEdit || !isActive) return;
    const cleanup = createVisibilityAwareInterval(() => {
      tryAcquireActivePaneLocks();
    }, 3_000 + Math.floor(Math.random() * 1000));
    return cleanup;
  }, [canEdit, currentUserId, isActive, tryAcquireActivePaneLocks]);

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
    if (!currentUserId || !isActive) return;
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

    const tick = async () => {
      const activeIds = new Set<string>();
      for (const paneId of panesToRender) {
        const id = activeTabIdByPane[paneId];
        if (id) activeIds.add(id);
      }
      for (const id of activeIds) {
        const tab = tabByIdRef.current[id];
        // Only heartbeat if we think we have the lock AND we have server info
        // (i.e. we are past the optimistic window)
        if (!tab?.hasLock || !tab.lockInfo) continue;

        // maintenance heartbeat
        try {
          const res = await refreshProjectNodeLock(projectId, id, 120);
          if (!res.ok) {
            // Lock lost on server (evicted or expired)
            if (!mountedRef.current) return;
            setTabById((prev) => {
              const current = prev[id];
              if (!current) return prev;
              return {
                ...prev,
                [id]: { ...current, hasLock: false },
              };
            });
            clearLock(projectId, id);
          }
        } catch {
          // Network failure - don't drop lock yet, retry next tick
        }
      }
      const nextDelay = document.hidden ? 170_000 : 50_000;
      schedule(nextDelay);
    };

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (!document.hidden) {
        tick();
      }
    };

    // Delay initial heartbeat to avoid collision with background acquisition
    schedule(30_000);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeTabIdByPane, currentUserId, isActive, panesToRender, projectId, leftActiveTabId, rightActiveTabId, clearLock, setTabById, tabByIdRef]);

  // FW2: Release locks on tab/window close via sendBeacon to prevent orphan locks
  useEffect(() => {
    if (!currentUserId || !isActive) return;

    const handleBeforeUnload = () => {
      const lockedNodeIds: string[] = [];
      const tabs = tabByIdRef.current;
      for (const id of Object.keys(tabs)) {
        const tab = tabs[id];
        if (tab?.hasLock && tab.lockInfo?.lockedBy === currentUserId) {
          lockedNodeIds.push(id);
        }
      }
      if (lockedNodeIds.length === 0) return;

      const payload = JSON.stringify({ projectId, nodeIds: lockedNodeIds });
      navigator.sendBeacon('/api/v1/files/locks/release', new Blob([payload], { type: 'application/json' }));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUserId, isActive, projectId, tabByIdRef]);

  return {
    acquireLockForNode,
    nextLockAttemptAtRef,
  };
}
