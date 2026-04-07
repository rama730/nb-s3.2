import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, NodeEventSummary, SoftLock } from "./types";
import { defaultWorkspace } from "./types";

export interface LocksSlice {
  setLock: (projectId: string, lock: SoftLock) => void;
  setLocks: (projectId: string, locks: SoftLock[]) => void;
  clearLock: (projectId: string, nodeId: string) => void;
  setLastNodeEventSummary: (projectId: string, nodeId: string, summary: NodeEventSummary) => void;
  clearLastNodeEventSummary: (projectId: string, nodeId: string) => void;
}

function normalizeLockedByName(value: string | null | undefined) {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mergeLockName(prevLock: SoftLock | undefined, lock: SoftLock): SoftLock {
  const incomingName = normalizeLockedByName(lock.lockedByName);
  const preservedName =
    prevLock?.lockedBy === lock.lockedBy
      ? normalizeLockedByName(prevLock.lockedByName)
      : null;

  return {
    ...lock,
    lockedByName: incomingName ?? preservedName ?? null,
  };
}

export const createLocksSlice: StateCreator<FilesWorkspaceState, [], [], LocksSlice> = (set) => ({
  setLock: (projectId, lock) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const prevLock = ws.locksByNodeId[lock.nodeId];
      const nextLock = mergeLockName(prevLock, lock);
      if (
        prevLock &&
        prevLock.lockedBy === nextLock.lockedBy &&
        prevLock.lockedByName === nextLock.lockedByName &&
        prevLock.expiresAt === nextLock.expiresAt
      ) {
        return state;
      }
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            locksByNodeId: { ...ws.locksByNodeId, [lock.nodeId]: nextLock },
          },
        },
      };
    }),

  setLocks: (projectId, locks) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextLocks = { ...ws.locksByNodeId };
      let changed = false;

      for (const l of locks) {
        const prev = nextLocks[l.nodeId];
        const nextLock = mergeLockName(prev, l);
        if (
          !prev ||
          prev.lockedBy !== nextLock.lockedBy ||
          prev.lockedByName !== nextLock.lockedByName ||
          prev.expiresAt !== nextLock.expiresAt
        ) {
          nextLocks[l.nodeId] = nextLock;
          changed = true;
        }
      }

      if (!changed) return state;

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, locksByNodeId: nextLocks },
        },
      };
    }),

  clearLock: (projectId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      if (!ws.locksByNodeId[nodeId]) {
        return state;
      }
      const next = { ...ws.locksByNodeId };
      delete next[nodeId];
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, locksByNodeId: next },
        },
      };
    }),

  setLastNodeEventSummary: (projectId, nodeId, summary) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const prev = ws.lastNodeEventsByNodeId[nodeId];
      if (
        prev &&
        prev.type === summary.type &&
        prev.at === summary.at &&
        prev.by === summary.by
      ) {
        return state;
      }

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            lastNodeEventsByNodeId: {
              ...ws.lastNodeEventsByNodeId,
              [nodeId]: summary,
            },
          },
        },
      };
    }),

  clearLastNodeEventSummary: (projectId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      if (!(nodeId in ws.lastNodeEventsByNodeId)) {
        return state;
      }

      const nextSummaries = { ...ws.lastNodeEventsByNodeId };
      delete nextSummaries[nodeId];

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            lastNodeEventsByNodeId: nextSummaries,
          },
        },
      };
    }),
});
