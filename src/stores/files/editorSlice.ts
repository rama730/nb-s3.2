import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, EditorPreferences, NodeEventSummary, SoftLock } from "./types";
import { defaultWorkspace } from "./types";
import { FILES_RUNTIME_BUDGETS, clampNumber } from "@/lib/files/runtime-budgets";

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

export interface EditorSlice {
  setPrefs: (projectId: string, prefs: Partial<EditorPreferences>) => void;

  setLocks: (projectId: string, locks: SoftLock[]) => void;
  setLastNodeEventSummary: (projectId: string, nodeId: string, summary: NodeEventSummary) => void;
  clearLastNodeEventSummary: (projectId: string, nodeId: string) => void;

}

export const createEditorSlice: StateCreator<FilesWorkspaceState, [], [], EditorSlice> = (set) => ({
  setPrefs: (projectId, prefs) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextPrefs: EditorPreferences = {
        ...ws.prefs,
        ...prefs,
        fontSize: clampNumber((prefs.fontSize ?? ws.prefs.fontSize), 12, 20),
        autosaveDelayMs: clampNumber(
          prefs.autosaveDelayMs ?? ws.prefs.autosaveDelayMs,
          FILES_RUNTIME_BUDGETS.autosaveDelayMinMs,
          FILES_RUNTIME_BUDGETS.autosaveDelayMaxMs
        ),
        inactiveAutosaveConcurrency: clampNumber(
          prefs.inactiveAutosaveConcurrency ?? ws.prefs.inactiveAutosaveConcurrency,
          1,
          FILES_RUNTIME_BUDGETS.backgroundAutosaveMaxConcurrency
        ),
      };
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, prefs: nextPrefs },
        },
      };
    }),
  setLocks: (projectId, locks) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextLocks: Record<string, SoftLock> = {};

      for (const l of locks) {
        if (l.expiresAt <= Date.now()) continue;
        const prev = ws.locksByNodeId[l.nodeId];
        const nextLock = mergeLockName(prev, l);
        nextLocks[l.nodeId] = nextLock;
      }

      const previousIds = Object.keys(ws.locksByNodeId);
      const nextIds = Object.keys(nextLocks);
      const changed = previousIds.length !== nextIds.length || nextIds.some((nodeId) => {
        const previous = ws.locksByNodeId[nodeId];
        const next = nextLocks[nodeId];
        return !previous || !next ||
          previous.lockedBy !== next.lockedBy ||
          previous.lockedByName !== next.lockedByName ||
          previous.clientKind !== next.clientKind ||
          previous.acquiredAt !== next.acquiredAt ||
          previous.renewedAt !== next.renewedAt ||
          previous.expiresAt !== next.expiresAt;
      });
      if (!changed) return state;

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, locksByNodeId: nextLocks },
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
