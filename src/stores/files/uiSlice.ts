import type { StateCreator } from "zustand";
import type { FileState, FilesWorkspaceState, UiState } from "./types";
import { defaultWorkspace } from "./types";
import { getFileContent, setFileContent } from "./contentMap";
import { estimateVisibleRowsBudget, evictLruIfNeeded } from "./filesSlice";

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
  clearProblems: (projectId: string) => void;
  applyQuickFix: (projectId: string, problemId: string) => void;
  setDebugOutput: (projectId: string, lines: string[]) => void;
  appendDebugOutput: (projectId: string, lines: string[]) => void;
  clearDebugOutput: (projectId: string) => void;
  pushCommandToHistory: (projectId: string, command: string) => void;
  setSidebarWidth: (projectId: string, width: number) => void;
  toggleSidebar: (projectId: string) => void;
  toggleZenMode: (projectId: string) => void;
  setOutputFilterMode: (projectId: string, mode: "all" | "out" | "err") => void;
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

  clearProblems: (projectId: string) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, problems: [] },
          },
        },
      };
    }),

  applyQuickFix: (projectId: string, problemId: string) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;

      const problems = ws.ui.problems || [];
      const problemIndex = problems.findIndex((p) => p.id === problemId);
      if (problemIndex === -1) return state;

      const problem = problems[problemIndex];
      // 3c: Apply the quick fix
      if (problem?.fix && problem.fix.action === "replace") {
        const target = problem.fix.targetString;
        const replacement = problem.fix.replacement;
        if (typeof replacement !== "string") {
          console.warn("Quick fix replacement is invalid", {
            projectId,
            problemId,
            nodeId: problem.nodeId,
          });
          return state;
        }
        const content = getFileContent(projectId, problem.nodeId);
        if (target) {
          const newContent = content.replaceAll(target, replacement);
          if (newContent !== content) {
            setFileContent(projectId, problem.nodeId, newContent);

            const prevFileState: FileState = ws.fileStates[problem.nodeId] || {
              content: "",
              contentVersion: 0,
              isDirty: false,
            };
            const now = Date.now();
            const nextFileState: FileState = {
              ...prevFileState,
              content: "",
              contentVersion: (prevFileState.contentVersion ?? 0) + 1,
              isDirty: true,
              lastAccessedAt: now,
            };
            const maxEntries = estimateVisibleRowsBudget(ws);
            const nextFileStates = evictLruIfNeeded(
              { ...ws.fileStates, [problem.nodeId]: nextFileState },
              maxEntries,
              projectId,
            );

            const nextProblems = [...problems];
            nextProblems.splice(problemIndex, 1);

            return {
              byProjectId: {
                ...state.byProjectId,
                [projectId]: {
                  ...ws,
                  fileStates: nextFileStates,
                  ui: { ...ws.ui, problems: nextProblems },
                },
              },
            };
          } else {
            console.warn("Quick fix had no effect", {
              projectId,
              problemId,
              nodeId: problem.nodeId,
              target,
            });
          }
        } else {
          console.warn("Quick fix target string is empty", {
            projectId,
            problemId,
            nodeId: problem.nodeId,
          });
        }
      }
      return state;
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

  setSidebarWidth: (projectId, width) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, sidebarWidth: Math.max(180, Math.min(600, width)) },
          },
        },
      };
    }),

  toggleSidebar: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, sidebarCollapsed: !ws.ui.sidebarCollapsed },
          },
        },
      };
    }),

  toggleZenMode: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const entering = !ws.ui.zenMode;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: {
              ...ws.ui,
              zenMode: entering,
              sidebarCollapsed: entering ? true : false,
              bottomPanelCollapsed: entering ? true : (ws.ui._prevBottomPanelCollapsed ?? false),
              _prevBottomPanelCollapsed: entering ? ws.ui.bottomPanelCollapsed : undefined,
            },
          },
        },
      };
    }),

  setOutputFilterMode: (projectId, mode) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            ui: { ...ws.ui, outputFilterMode: mode },
          },
        },
      };
    }),
});
