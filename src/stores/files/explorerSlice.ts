import type { StateCreator } from "zustand";
import type {
  FilesWorkspaceState,
  ExplorerMode,
  FilesViewMode,
  ExplorerSort,
  SavedExplorerView,
} from "./types";
import { defaultWorkspace } from "./types";

export interface ExplorerSlice {
  setExplorerMode: (projectId: string, mode: ExplorerMode) => void;
  setViewMode: (projectId: string, mode: FilesViewMode) => void;
  setSelectedNode: (projectId: string, nodeId: string | null, parentId?: string | null) => void;
  setSelectedNodeIds: (projectId: string, nodeIds: string[]) => void;
  toggleExpanded: (projectId: string, folderId: string, expanded?: boolean) => void;
  setSearchQuery: (projectId: string, query: string) => void;
  setSort: (projectId: string, sort: ExplorerSort) => void;
  setFoldersFirst: (projectId: string, foldersFirst: boolean) => void;
  addRecent: (projectId: string, nodeId: string) => void;
  toggleFavorite: (projectId: string, nodeId: string) => void;
  saveCurrentView: (projectId: string, name: string) => void;
  applySavedView: (projectId: string, viewId: string) => void;
  deleteSavedView: (projectId: string, viewId: string) => void;
}

export const createExplorerSlice: StateCreator<FilesWorkspaceState, [], [], ExplorerSlice> = (set) => ({
  setExplorerMode: (projectId, mode) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextViewMode = ws.viewModeByExplorerMode[mode] ?? ws.viewMode;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            explorerMode: mode,
            viewMode: nextViewMode,
          },
        },
      };
    }),

  setViewMode: (projectId, mode) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            viewMode: mode,
            viewModeByExplorerMode: {
              ...ws.viewModeByExplorerMode,
              [ws.explorerMode]: mode,
            },
          },
        },
      };
    }),

  setSelectedNode: (projectId, nodeId, parentId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextSelectedFolderId =
        parentId !== undefined ? parentId : ws.selectedFolderId;
      const changed =
        ws.selectedNodeId !== nodeId || ws.selectedFolderId !== nextSelectedFolderId;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            selectedNodeId: nodeId,
            selectedFolderId: nextSelectedFolderId,
            selectionVersion: changed ? ws.selectionVersion + 1 : ws.selectionVersion,
          },
        },
      };
    }),

  setSelectedNodeIds: (projectId, nodeIds) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextSelectedNodeId =
        nodeIds.length === 1 ? nodeIds[0] : (nodeIds.length === 0 ? null : ws.selectedNodeId);
      const changed =
        ws.selectedNodeId !== nextSelectedNodeId ||
        ws.selectedNodeIds.length !== nodeIds.length ||
        ws.selectedNodeIds.some((id, index) => id !== nodeIds[index]);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            selectedNodeIds: nodeIds,
            selectedNodeId: nextSelectedNodeId,
            selectionVersion: changed ? ws.selectionVersion + 1 : ws.selectionVersion,
          },
        },
      };
    }),

  toggleExpanded: (projectId, folderId, expanded) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const current = !!ws.expandedFolderIds[folderId];
      const next = expanded !== undefined ? expanded : !current;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            expandedFolderIds: {
              ...ws.expandedFolderIds,
              [folderId]: next,
            },
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setSearchQuery: (projectId, query) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, searchQuery: query },
        },
      };
    }),

  setSort: (projectId, sort) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, sort },
        },
      };
    }),

  setFoldersFirst: (projectId, foldersFirst) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, foldersFirst },
        },
      };
    }),

  addRecent: (projectId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const next = [nodeId, ...ws.recents.filter((id) => id !== nodeId)].slice(0, 30);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, recents: next },
        },
      };
    }),

  toggleFavorite: (projectId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const next = { ...ws.favorites };
      if (next[nodeId]) {
        delete next[nodeId];
      } else {
        next[nodeId] = true;
      }
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, favorites: next },
        },
      };
    }),

  saveCurrentView: (projectId, name) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const cleanName = (name || "").trim();
      if (!cleanName) return state;

      const now = Date.now();
      const config: SavedExplorerView["config"] = {
        explorerMode: ws.explorerMode,
        viewMode: ws.viewMode,
        sort: ws.sort,
        foldersFirst: ws.foldersFirst,
        selectedFolderId: ws.selectedFolderId ?? null,
      };

      const existing = ws.savedViews.find(
        (view) => view.name.toLowerCase() === cleanName.toLowerCase()
      );
      const nextViews = existing
        ? ws.savedViews.map((view) =>
          view.id === existing.id
            ? { ...view, name: cleanName, config, createdAt: now }
            : view
        )
        : [
          {
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            name: cleanName,
            createdAt: now,
            config,
          },
          ...ws.savedViews,
        ];

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            savedViews: nextViews.slice(0, 20),
          },
        },
      };
    }),

  applySavedView: (projectId, viewId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const view = ws.savedViews.find((entry) => entry.id === viewId);
      if (!view) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            explorerMode: view.config.explorerMode,
            viewMode: view.config.viewMode,
            viewModeByExplorerMode: {
              ...ws.viewModeByExplorerMode,
              [view.config.explorerMode]: view.config.viewMode,
            },
            sort: view.config.sort,
            foldersFirst: view.config.foldersFirst,
            selectedFolderId: view.config.selectedFolderId,
            searchQuery: view.config.explorerMode === "search" ? ws.searchQuery : "",
          },
        },
      };
    }),

  deleteSavedView: (projectId, viewId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            savedViews: ws.savedViews.filter((view) => view.id !== viewId),
          },
        },
      };
    }),
});
