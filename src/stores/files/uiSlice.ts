import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, UiState } from "./types";
import { defaultWorkspace } from "./types";

export interface UiSlice {
  setBottomPanelTab: (projectId: string, tab: UiState["bottomPanelTab"]) => void;
  setBottomPanelHeight: (projectId: string, height: number) => void;
  toggleBottomPanel: (projectId: string) => void;
  setSearchReplaceOpen: (projectId: string, open: boolean) => void;
  setCommandPaletteOpen: (projectId: string, open: boolean) => void;
  setQuickOpenOpen: (projectId: string, open: boolean) => void;
  setLastExecutionOutput: (projectId: string, lines: string[]) => void;
  setLastExecutionSettingsHref: (projectId: string, href: string | null) => void;
  setStdinInputText: (projectId: string, text: string) => void;
  setProblems: (projectId: string, problems: import("./types").Problem[]) => void;
  setDebugOutput: (projectId: string, lines: string[]) => void;
  appendDebugOutput: (projectId: string, lines: string[]) => void;
  clearDebugOutput: (projectId: string) => void;
  pushCommandToHistory: (projectId: string, command: string) => void;
}

export const createUiSlice: StateCreator<FilesWorkspaceState, [], [], UiSlice> = (set) => ({
  setBottomPanelTab: (projectId, tab) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, bottomPanelTab: tab },
          },
        },
      };
    }),

  setBottomPanelHeight: (projectId, height) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, bottomPanelHeight: Math.max(100, height) },
          },
        },
      };
    }),

  toggleBottomPanel: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, bottomPanelCollapsed: !ws.ui.bottomPanelCollapsed },
          },
        },
      };
    }),

  setSearchReplaceOpen: (projectId, open) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, searchReplaceOpen: open },
          },
        },
      };
    }),

  setCommandPaletteOpen: (projectId, open) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, commandPaletteOpen: open },
          },
        },
      };
    }),

  setQuickOpenOpen: (projectId, open) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, quickOpenOpen: open },
          },
        },
      };
    }),

  setLastExecutionOutput: (projectId, lines) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, lastExecutionOutput: lines },
          },
        },
      };
    }),

  setLastExecutionSettingsHref: (projectId, href) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, lastExecutionSettingsHref: href },
          },
        },
      };
    }),

  setStdinInputText: (projectId, text) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, stdinInputText: text },
          },
        },
      };
    }),

  setProblems: (projectId, problems) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, problems },
          },
        },
      };
    }),

  setDebugOutput: (projectId, lines) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, debugOutput: lines },
          },
        },
      };
    }),

  appendDebugOutput: (projectId, lines) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const existing = ws.ui.debugOutput ?? [];
      const merged = [...existing, ...lines];
      const capped = merged.length > 500 ? merged.slice(-500) : merged;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, debugOutput: capped },
          },
        },
      };
    }),

  clearDebugOutput: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, debugOutput: [] },
          },
        },
      };
    }),

  pushCommandToHistory: (projectId, command) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const existing = ws.ui.commandHistory ?? [];
      const trimmed = command.trim();
      if (!trimmed) return state;
      const filtered = existing.filter((c) => c !== trimmed);
      const next = [trimmed, ...filtered].slice(0, 50);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, commandHistory: next },
          },
        },
      };
    }),
});
