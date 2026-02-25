import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, SoftLock } from "./types";
import { defaultWorkspace } from "./types";

export interface LocksSlice {
  setLock: (projectId: string, lock: SoftLock) => void;
  clearLock: (projectId: string, nodeId: string) => void;
}

export const createLocksSlice: StateCreator<FilesWorkspaceState, [], [], LocksSlice> = (set) => ({
  setLock: (projectId, lock) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const prevLock = ws.locksByNodeId[lock.nodeId];
      if (
        prevLock &&
        prevLock.lockedBy === lock.lockedBy &&
        prevLock.lockedByName === lock.lockedByName &&
        prevLock.expiresAt === lock.expiresAt
      ) {
        return state;
      }
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            locksByNodeId: { ...ws.locksByNodeId, [lock.nodeId]: lock },
          },
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
});
