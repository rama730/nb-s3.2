import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, EditorPreferences, EditorSymbol } from "./types";
import { defaultWorkspace, symbolsEqual } from "./types";
import { FILES_RUNTIME_BUDGETS, clampNumber } from "@/lib/files/runtime-budgets";

export interface EditorSlice {
  setPrefs: (projectId: string, prefs: Partial<EditorPreferences>) => void;
  setActiveFileSymbols: (projectId: string, symbols: EditorSymbol[]) => void;
  requestScrollTo: (projectId: string, nodeId: string, line: number) => void;
  clearScrollRequest: (projectId: string) => void;
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

  setActiveFileSymbols: (projectId, symbols) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      if (symbolsEqual(ws.activeFileSymbols, symbols)) {
        return state;
      }
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, activeFileSymbols: symbols },
        },
      };
    }),

  requestScrollTo: (projectId, nodeId, line) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, requestedScrollPosition: { nodeId, line } },
        },
      };
    }),

  clearScrollRequest: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, requestedScrollPosition: null },
        },
      };
    }),
});
