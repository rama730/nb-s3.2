"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProjectNode } from "@/lib/db/schema";

export type ExplorerSort = "name" | "updated" | "type";
export type ExplorerMode = "tree" | "search" | "favorites" | "recents" | "trash";

export type EditorPreferences = {
  lineNumbers: boolean;
  wordWrap: boolean;
  fontSize: number;
  minimap: boolean;
};

export type WorkspaceTab = {
  id: string; // nodeId
  pinned: boolean;
};

export type WorkspacePane = {
  id: "left" | "right";
  openTabIds: string[];
  activeTabId: string | null;
};

export type SoftLock = {
  nodeId: string;
  lockedBy: string;
  lockedByName?: string | null;
  expiresAt: number;
};

type ProjectWorkspaceState = {
  // ---- Explorer ----
  explorerMode: ExplorerMode;
  selectedNodeId: string | null;
  selectedFolderId: string | null;
  expandedFolderIds: Record<string, boolean>;
  searchQuery: string;
  sort: ExplorerSort;
  foldersFirst: boolean;
  favorites: Record<string, boolean>;
  recents: string[];

  // Cached metadata
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>; // parentId key; root uses "__root__"
  loadedChildren: Record<string, boolean>;
  taskLinkCounts: Record<string, number>; // nodeId -> count

  // ---- Workspace (tabs/split) ----
  splitEnabled: boolean;
  splitRatio: number; // 0.2..0.8
  panes: Record<WorkspacePane["id"], WorkspacePane>;
  pinnedByTabId: Record<string, boolean>;

  // ---- Editor prefs ----
  prefs: EditorPreferences;

  // ---- Collaboration ----
  locksByNodeId: Record<string, SoftLock>;
};

type FilesWorkspaceState = {
  byProjectId: Record<string, ProjectWorkspaceState>;

  // getters
  _get: (projectId: string) => ProjectWorkspaceState;

  // explorer actions
  setExplorerMode: (projectId: string, mode: ExplorerMode) => void;
  setSelectedNode: (projectId: string, nodeId: string | null, parentId?: string | null) => void;
  toggleExpanded: (projectId: string, folderId: string, expanded?: boolean) => void;
  setSearchQuery: (projectId: string, query: string) => void;
  setSort: (projectId: string, sort: ExplorerSort) => void;
  setFoldersFirst: (projectId: string, foldersFirst: boolean) => void;
  addRecent: (projectId: string, nodeId: string) => void;
  toggleFavorite: (projectId: string, nodeId: string) => void;

  // cache actions
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setChildren: (projectId: string, parentId: string | null, childIds: string[]) => void;
  markChildrenLoaded: (projectId: string, parentId: string | null) => void;
  removeNodeFromCaches: (projectId: string, nodeId: string) => void;
  setTaskLinkCounts: (projectId: string, counts: Record<string, number>) => void;

  // workspace actions
  setSplitEnabled: (projectId: string, enabled: boolean) => void;
  setSplitRatio: (projectId: string, ratio: number) => void;
  openTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string) => void;
  closeTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string) => void;
  pinTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string, pinned: boolean) => void;
  closeOtherTabs: (projectId: string, paneId: WorkspacePane["id"], keepNodeId: string) => void;
  closeTabsToRight: (projectId: string, paneId: WorkspacePane["id"], fromNodeId: string) => void;
  setActiveTab: (projectId: string, paneId: WorkspacePane["id"], nodeId: string | null) => void;

  // prefs
  setPrefs: (projectId: string, prefs: Partial<EditorPreferences>) => void;

  // locks
  setLock: (projectId: string, lock: SoftLock) => void;
  clearLock: (projectId: string, nodeId: string) => void;
};

const DEFAULT_PREFS: EditorPreferences = {
  lineNumbers: true,
  wordWrap: true,
  fontSize: 14,
  minimap: false,
};

function defaultWorkspace(): ProjectWorkspaceState {
  return {
    explorerMode: "tree",
    selectedNodeId: null,
    selectedFolderId: null,
    expandedFolderIds: {},
    searchQuery: "",
    sort: "name",
    foldersFirst: true,
    favorites: {},
    recents: [],

    nodesById: {},
    childrenByParentId: {},
    loadedChildren: {},
    taskLinkCounts: {},

    splitEnabled: false,
    splitRatio: 0.5,
    panes: {
      left: { id: "left", openTabIds: [], activeTabId: null },
      right: { id: "right", openTabIds: [], activeTabId: null },
    },
    pinnedByTabId: {},

    prefs: DEFAULT_PREFS,
    locksByNodeId: {},
  };
}

const ROOT_KEY = "__root__";
const parentKey = (parentId: string | null) => parentId ?? ROOT_KEY;

export const useFilesWorkspaceStore = create<FilesWorkspaceState>()(
  persist(
    (set, get) => ({
      byProjectId: {},

      _get: (projectId) => get().byProjectId[projectId] ?? defaultWorkspace(),

      setExplorerMode: (projectId, mode) =>
        set((state) => ({
          byProjectId: {
            ...state.byProjectId,
            [projectId]: {
              ...(state.byProjectId[projectId] ?? defaultWorkspace()),
              explorerMode: mode,
            },
          },
        })),

      setSelectedNode: (projectId, nodeId, parentId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                selectedNodeId: nodeId,
                selectedFolderId:
                  parentId !== undefined ? parentId : ws.selectedFolderId,
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
          const next = [nodeId, ...ws.recents.filter((id) => id !== nodeId)].slice(
            0,
            30
          );
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
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                favorites: { ...ws.favorites, [nodeId]: !ws.favorites[nodeId] },
              },
            },
          };
        }),

      upsertNodes: (projectId, nodes) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const nextById = { ...ws.nodesById };
          for (const n of nodes) nextById[n.id] = n;
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: { ...ws, nodesById: nextById },
            },
          };
        }),

      setChildren: (projectId, parentId, childIds) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const key = parentKey(parentId);
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                childrenByParentId: { ...ws.childrenByParentId, [key]: childIds },
              },
            },
          };
        }),

      markChildrenLoaded: (projectId, parentId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const key = parentKey(parentId);
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                loadedChildren: { ...ws.loadedChildren, [key]: true },
              },
            },
          };
        }),

      removeNodeFromCaches: (projectId, nodeId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const nextById = { ...ws.nodesById };
          const node = nextById[nodeId];
          delete nextById[nodeId];

          const nextChildren = { ...ws.childrenByParentId };
          // remove from its parent list (best effort)
          if (node) {
            const key = parentKey(node.parentId ?? null);
            if (nextChildren[key]) nextChildren[key] = nextChildren[key].filter((id) => id !== nodeId);
          } else {
            // remove from all lists if unknown
            for (const k of Object.keys(nextChildren)) {
              nextChildren[k] = nextChildren[k].filter((id) => id !== nodeId);
            }
          }

          const nextRecents = ws.recents.filter((id) => id !== nodeId);
          const nextFav = { ...ws.favorites };
          delete nextFav[nodeId];
          const nextPinned = { ...ws.pinnedByTabId };
          delete nextPinned[nodeId];

          // close from panes
          const closeFromPane = (pane: WorkspacePane) => ({
            ...pane,
            openTabIds: pane.openTabIds.filter((id) => id !== nodeId),
            activeTabId: pane.activeTabId === nodeId ? null : pane.activeTabId,
          });

          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                nodesById: nextById,
                childrenByParentId: nextChildren,
                recents: nextRecents,
                favorites: nextFav,
                pinnedByTabId: nextPinned,
                panes: {
                  left: closeFromPane(ws.panes.left),
                  right: closeFromPane(ws.panes.right),
                },
              },
            },
          };
        }),

      setTaskLinkCounts: (projectId, counts) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: { ...ws, taskLinkCounts: { ...ws.taskLinkCounts, ...counts } },
            },
          };
        }),

      setSplitEnabled: (projectId, enabled) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: { ...ws, splitEnabled: enabled },
            },
          };
        }),

      setSplitRatio: (projectId, ratio) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const clamped = Math.min(0.8, Math.max(0.2, ratio));
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: { ...ws, splitRatio: clamped },
            },
          };
        }),

      openTab: (projectId, paneId, nodeId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const pane = ws.panes[paneId];
          const openTabIds = pane.openTabIds.includes(nodeId)
            ? pane.openTabIds
            : [...pane.openTabIds, nodeId];
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                panes: {
                  ...ws.panes,
                  [paneId]: { ...pane, openTabIds, activeTabId: nodeId },
                },
              },
            },
          };
        }),

      closeTab: (projectId, paneId, nodeId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const pane = ws.panes[paneId];
          const openTabIds = pane.openTabIds.filter((id) => id !== nodeId);
          const activeTabId =
            pane.activeTabId === nodeId
              ? openTabIds[openTabIds.length - 1] ?? null
              : pane.activeTabId;
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                panes: { ...ws.panes, [paneId]: { ...pane, openTabIds, activeTabId } },
              },
            },
          };
        }),

      pinTab: (projectId, paneId, nodeId, pinned) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                pinnedByTabId: { ...ws.pinnedByTabId, [nodeId]: pinned },
              },
            },
          };
        }),

      closeOtherTabs: (projectId, paneId, keepNodeId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const pane = ws.panes[paneId];
          const openTabIds = pane.openTabIds.filter((id) => id === keepNodeId);
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                panes: {
                  ...ws.panes,
                  [paneId]: { ...pane, openTabIds, activeTabId: keepNodeId },
                },
              },
            },
          };
        }),

      closeTabsToRight: (projectId, paneId, fromNodeId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const pane = ws.panes[paneId];
          const idx = pane.openTabIds.indexOf(fromNodeId);
          if (idx === -1) return state;
          const openTabIds = pane.openTabIds.slice(0, idx + 1);
          const activeTabId =
            pane.activeTabId && openTabIds.includes(pane.activeTabId)
              ? pane.activeTabId
              : fromNodeId;
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                panes: {
                  ...ws.panes,
                  [paneId]: { ...pane, openTabIds, activeTabId },
                },
              },
            },
          };
        }),

      setActiveTab: (projectId, paneId, nodeId) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          const pane = ws.panes[paneId];
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: {
                ...ws,
                panes: { ...ws.panes, [paneId]: { ...pane, activeTabId: nodeId } },
              },
            },
          };
        }),

      setPrefs: (projectId, prefs) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: { ...ws, prefs: { ...ws.prefs, ...prefs } },
            },
          };
        }),

      setLock: (projectId, lock) =>
        set((state) => {
          const ws = state.byProjectId[projectId] ?? defaultWorkspace();
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
          const next = { ...ws.locksByNodeId };
          delete next[nodeId];
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: { ...ws, locksByNodeId: next },
            },
          };
        }),
    }),
    {
      name: "files-workspace-v2",
      partialize: (state) => ({
        byProjectId: Object.fromEntries(
          Object.entries(state.byProjectId).map(([projectId, ws]) => [
            projectId,
            {
              // persist UX prefs + workspace state; do not persist server caches
              explorerMode: ws.explorerMode,
              expandedFolderIds: ws.expandedFolderIds,
              sort: ws.sort,
              foldersFirst: ws.foldersFirst,
              favorites: ws.favorites,
              recents: ws.recents,
              splitEnabled: ws.splitEnabled,
              splitRatio: ws.splitRatio,
              panes: ws.panes,
              pinnedByTabId: ws.pinnedByTabId,
              prefs: ws.prefs,
            } as Partial<ProjectWorkspaceState>,
          ])
        ),
      }),
      merge: (persistedState: any, currentState) => {
        // Custom merge to ensure non-persisted fields (caches) are initialized with defaults
        if (!persistedState || !persistedState.byProjectId) {
          return currentState;
        }

        const mergedByProjectId: Record<string, ProjectWorkspaceState> = { ...currentState.byProjectId };

        for (const [projectId, persistedProjectState] of Object.entries(persistedState.byProjectId)) {
          mergedByProjectId[projectId] = {
            ...defaultWorkspace(),
            ...(persistedProjectState as Partial<ProjectWorkspaceState>),
            // Ensure critical non-persisted collections are at least empty objects if default doesn't provide them (it does)
            // We rely on defaultWorkspace() to provide the empty cache objects.
          };
        }

        return {
          ...currentState,
          ...persistedState,
          byProjectId: mergedByProjectId,
        };
      },
    }
  )
);

export const FILES_ROOT_KEY = ROOT_KEY;
export const filesParentKey = parentKey;

