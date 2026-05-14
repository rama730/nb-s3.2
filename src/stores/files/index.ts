// TODO(perf): Consolidate 7 slices into 4 logical domains:
// - explorerSlice + filesSlice → explorerSlice
// - workspaceSlice + uiSlice → workspaceSlice
// - editorSlice + locksSlice → editorSlice
// - gitSlice (keep standalone)
// This reduces cross-slice coordination complexity and onboarding time.
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
      ...createUiSlice(set, get, api),
    }),
    {
      name: "files-workspace-v3",
      partialize: (state) => ({
        byProjectId: Object.fromEntries(
          Object.entries(state.byProjectId).map(([projectId, ws]: [string, ProjectWorkspaceState]) => [
            projectId,
            // Files tab v3 persist shape (Req 15.19, Req 21.7; design § Migration Note).
            // Persist ONLY the fields listed below. Any legacy key from a
            // `files-workspace-v2` blob is ignored by the updated merge function,
            // which overlays the persisted partial onto a fresh `defaultWorkspace()`.
            {
              currentLocationId: ws.currentLocationId,
              expandedFolderIds: ws.expandedFolderIds,
              favorites: ws.favorites,
              recents: ws.recents,
              sort: ws.sort,
              foldersFirst: ws.foldersFirst,
              ui: {
                sidebarCollapsed: ws.ui.sidebarCollapsed,
                quickOpenOpen: ws.ui.quickOpenOpen,
              },
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
          const fresh = defaultWorkspace();
          const partial = (persistedProjectState ?? {}) as Partial<ProjectWorkspaceState> & {
            ui?: Partial<ProjectWorkspaceState["ui"]>;
          };
          // Merge `ui` separately so we only accept the two persisted ui keys
          // and keep every other default ui value untouched.
          const mergedUi = partial.ui
            ? {
                ...fresh.ui,
                sidebarCollapsed:
                  typeof partial.ui.sidebarCollapsed === "boolean"
                    ? partial.ui.sidebarCollapsed
                    : fresh.ui.sidebarCollapsed,
                quickOpenOpen:
                  typeof partial.ui.quickOpenOpen === "boolean"
                    ? partial.ui.quickOpenOpen
                    : fresh.ui.quickOpenOpen,
              }
            : fresh.ui;
          mergedByProjectId[projectId] = {
            ...fresh,
            ...partial,
            ui: mergedUi,
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
  NodeEventSummary,
  FileState,
  EditorSymbol,
  ProjectWorkspaceState,
  FilesWorkspaceState,
  GitState,
  UiState,
} from "./types";

export {
  defaultWorkspace,
  symbolsEqual,
  FALLBACK_WORKSPACE,
  DEFAULT_PREFS,
  DEFAULT_GIT_STATE,
  DEFAULT_UI_STATE,
  ROOT_KEY,
  parentKey,
} from "./types";

export {
  contentKey,
  getFileContent,
  setFileContent,
  deleteFileContent,
  clearProjectContent,
  contentMapSize,
} from "./contentMap";
