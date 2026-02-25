"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type { ProjectWorkspaceState, FilesWorkspaceState } from "./types";
import {
  defaultWorkspace,
  FALLBACK_WORKSPACE,
  ROOT_KEY,
  parentKey,
} from "./types";
import { createExplorerSlice } from "./explorerSlice";
import { createWorkspaceSlice } from "./workspaceSlice";
import { createFilesSlice } from "./filesSlice";
import { createEditorSlice } from "./editorSlice";
import { createLocksSlice } from "./locksSlice";
import { createGitSlice } from "./gitSlice";
import { createTerminalSlice } from "./terminalSlice";
import { createUiSlice } from "./uiSlice";

export const useFilesWorkspaceStore = create<FilesWorkspaceState>()(
  persist(
    (set, get, api) => ({
      byProjectId: {},

      _get: (projectId) => get().byProjectId[projectId] ?? FALLBACK_WORKSPACE,

      ensureProjectWorkspace: (projectId) =>
        set((state) => {
          if (state.byProjectId[projectId]) return state;
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: defaultWorkspace(),
            },
          };
        }),

      ...createExplorerSlice(set, get, api),
      ...createWorkspaceSlice(set, get, api),
      ...createFilesSlice(set, get, api),
      ...createEditorSlice(set, get, api),
      ...createLocksSlice(set, get, api),
      ...createGitSlice(set, get, api),
      ...createTerminalSlice(set, get, api),
      ...createUiSlice(set, get, api),
    }),
    {
      name: "files-workspace-v2",
      partialize: (state) => ({
        byProjectId: Object.fromEntries(
          Object.entries(state.byProjectId).map(([projectId, ws]: [string, ProjectWorkspaceState]) => [
            projectId,
            {
              explorerMode: ws.explorerMode,
              viewMode: ws.viewMode,
              viewModeByExplorerMode: ws.viewModeByExplorerMode,
              expandedFolderIds: ws.expandedFolderIds,
              sort: ws.sort,
              foldersFirst: ws.foldersFirst,
              favorites: ws.favorites,
              recents: ws.recents,
              savedViews: ws.savedViews,
              splitEnabled: ws.splitEnabled,
              splitRatio: ws.splitRatio,
              panes: ws.panes,
              pinnedByTabId: ws.pinnedByTabId,
              prefs: ws.prefs,
            } as Partial<ProjectWorkspaceState>,
          ])
        ),
      }),
      merge: (persistedState: unknown, currentState) => {
        if (
          !persistedState ||
          typeof persistedState !== "object" ||
          !("byProjectId" in persistedState)
        ) {
          return currentState;
        }

        const persisted = persistedState as { byProjectId?: Record<string, Partial<ProjectWorkspaceState>> };
        if (!persisted.byProjectId) return currentState;

        const mergedByProjectId: Record<string, ProjectWorkspaceState> = { ...currentState.byProjectId };

        for (const [projectId, persistedProjectState] of Object.entries(persisted.byProjectId)) {
          mergedByProjectId[projectId] = {
            ...defaultWorkspace(),
            ...(persistedProjectState as Partial<ProjectWorkspaceState>),
          };
        }

        return {
          ...currentState,
          byProjectId: mergedByProjectId,
        };
      },
    }
  )
);

export const FILES_ROOT_KEY = ROOT_KEY;
export const filesParentKey = parentKey;

export const useFilesActions = () =>
  useFilesWorkspaceStore(
    useShallow((s) => ({
      upsertNodes: s.upsertNodes,
      setChildren: s.setChildren,
      markChildrenLoaded: s.markChildrenLoaded,
      toggleExpanded: s.toggleExpanded,
      setSelectedNode: s.setSelectedNode,
      openTab: s.openTab,
      closeTab: s.closeTab,
      setActiveTab: s.setActiveTab,
    }))
  );

export function useFilesProjectSlice(projectId: string) {
  return useFilesWorkspaceStore((s) => s.byProjectId[projectId]);
}

export type {
  ExplorerSort,
  ExplorerMode,
  FilesViewMode,
  SavedExplorerView,
  EditorPreferences,
  WorkspaceTab,
  WorkspacePane,
  SoftLock,
  FileState,
  EditorSymbol,
  ProjectWorkspaceState,
  FilesWorkspaceState,
  GitState,
  TerminalSession,
  TerminalState,
  UiState,
} from "./types";

export {
  defaultWorkspace,
  symbolsEqual,
  FALLBACK_WORKSPACE,
  DEFAULT_PREFS,
  DEFAULT_GIT_STATE,
  DEFAULT_TERMINAL_STATE,
  DEFAULT_UI_STATE,
  ROOT_KEY,
  parentKey,
} from "./types";
