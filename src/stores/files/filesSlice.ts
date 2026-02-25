import type { StateCreator } from "zustand";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceState, FileState, WorkspacePane } from "./types";
import { defaultWorkspace, parentKey } from "./types";
import { FILES_RUNTIME_BUDGETS, clampNumber } from "@/lib/files/runtime-budgets";

export interface FilesSlice {
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setChildren: (projectId: string, parentId: string | null, childIds: string[]) => void;
  setFolderPayload: (
    projectId: string,
    parentId: string | null,
    payload: { childIds: string[]; nextCursor: string | null; hasMore: boolean; loaded: boolean }
  ) => void;
  setNodesAndChildren: (
    projectId: string,
    nodes: ProjectNode[],
    parentId: string | null,
    childIds: string[],
    payload?: { nextCursor: string | null; hasMore: boolean; loaded: boolean }
  ) => void;
  markChildrenLoaded: (projectId: string, parentId: string | null) => void;
  setFolderMeta: (projectId: string, folderId: string | null, meta: { nextCursor: string | null; hasMore: boolean }) => void;
  removeNodeFromCaches: (projectId: string, nodeId: string) => void;
  setTaskLinkCounts: (projectId: string, counts: Record<string, number>) => void;
  setNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setFileState: (projectId: string, nodeId: string, state: Partial<FileState>) => void;
}

function evictLruIfNeeded(
  fileStates: Record<string, FileState>,
  maxEntries: number
): Record<string, FileState> {
  const entries = Object.entries(fileStates);
  if (entries.length <= maxEntries) return fileStates;

  const sorted = entries.sort(
    (a, b) => (a[1].lastAccessedAt ?? 0) - (b[1].lastAccessedAt ?? 0)
  );

  const result: Record<string, FileState> = {};
  const toKeep = sorted.filter(([, s]) => s.isDirty);
  const nonDirty = sorted.filter(([, s]) => !s.isDirty);
  const budget = Math.max(0, maxEntries - toKeep.length);
  const kept = nonDirty.slice(Math.max(0, nonDirty.length - budget));

  for (const [id, s] of [...toKeep, ...kept]) {
    result[id] = s;
  }
  return result;
}

function estimateVisibleRowsBudget(ws: FilesWorkspaceState["byProjectId"][string] | undefined) {
  if (!ws) return FILES_RUNTIME_BUDGETS.fileCacheFallbackEntries;
  const selectedParentKey = parentKey(ws.selectedFolderId ?? null);
  const selectedFolderCount = ws.childrenByParentId[selectedParentKey]?.length ?? 0;
  const rootCount = ws.childrenByParentId[parentKey(null)]?.length ?? 0;
  const openTabsCount =
    (ws.panes.left.openTabIds?.length ?? 0) + (ws.panes.right.openTabIds?.length ?? 0);
  const estimatedVisibleRows = Math.max(selectedFolderCount, rootCount, openTabsCount, 16);
  return clampNumber(
    estimatedVisibleRows * 2,
    FILES_RUNTIME_BUDGETS.fileCacheMinEntries,
    FILES_RUNTIME_BUDGETS.fileCacheMaxEntries
  );
}

export const createFilesSlice: StateCreator<FilesWorkspaceState, [], [], FilesSlice> = (set) => ({
  upsertNodes: (projectId, nodes) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      if (nodes.length === 0) return state;
      const nextById = { ...ws.nodesById };
      let changed = false;
      for (const n of nodes) {
        const existing = nextById[n.id];
        if (!existing || existing.updatedAt?.getTime() !== n.updatedAt?.getTime()) {
          nextById[n.id] = n;
          changed = true;
        }
      }
      if (!changed) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, nodesById: nextById, treeVersion: ws.treeVersion + 1 },
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
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setFolderPayload: (projectId, parentId, payload) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(parentId);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            childrenByParentId: { ...ws.childrenByParentId, [key]: payload.childIds },
            loadedChildren: payload.loaded
              ? { ...ws.loadedChildren, [key]: true }
              : ws.loadedChildren,
            folderMeta: {
              ...ws.folderMeta,
              [key]: { nextCursor: payload.nextCursor, hasMore: payload.hasMore },
            },
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setNodesAndChildren: (projectId, nodes, parentId, childIds, payload) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(parentId);
      const nextById = { ...ws.nodesById };
      for (const n of nodes) nextById[n.id] = n;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            nodesById: nextById,
            childrenByParentId: { ...ws.childrenByParentId, [key]: childIds },
            loadedChildren: payload?.loaded
              ? { ...ws.loadedChildren, [key]: true }
              : ws.loadedChildren,
            folderMeta: payload
              ? {
                  ...ws.folderMeta,
                  [key]: { nextCursor: payload.nextCursor, hasMore: payload.hasMore },
                }
              : ws.folderMeta,
            treeVersion: ws.treeVersion + 1,
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
            treeVersion: ws.treeVersion + 1,
          },
        },
      };
    }),

  setFolderMeta: (projectId, folderId, meta) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const key = parentKey(folderId);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            folderMeta: { ...ws.folderMeta, [key]: meta },
            treeVersion: ws.treeVersion + 1,
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
      if (node) {
        const key = parentKey(node.parentId ?? null);
        if (nextChildren[key]) nextChildren[key] = nextChildren[key].filter((id) => id !== nodeId);
      } else {
        for (const k of Object.keys(nextChildren)) {
          nextChildren[k] = nextChildren[k].filter((id) => id !== nodeId);
        }
      }

      const nextRecents = ws.recents.filter((id) => id !== nodeId);
      const nextFav = { ...ws.favorites };
      delete nextFav[nodeId];
      const nextPinned = { ...ws.pinnedByTabId };
      delete nextPinned[nodeId];
      const nextFileStates = { ...ws.fileStates };
      delete nextFileStates[nodeId];

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
            fileStates: nextFileStates,
            treeVersion: ws.treeVersion + 1,
            tabsVersion: ws.tabsVersion + 1,
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
      const ws = state.byProjectId[projectId];
      if (!ws) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            taskLinkCounts: { ...ws.taskLinkCounts, ...counts },
          },
        },
      };
    }),

  setNodes: (projectId, nodes) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nodesById = { ...ws.nodesById };
      const childrenByParentId = { ...ws.childrenByParentId };

      for (const node of nodes) {
        nodesById[node.id] = node;
        const pid = parentKey(node.parentId ?? null);
        const existing = childrenByParentId[pid];
        if (!existing) {
          childrenByParentId[pid] = [node.id];
        } else if (!existing.includes(node.id)) {
          childrenByParentId[pid] = [...existing, node.id];
        }
      }

      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, nodesById, childrenByParentId, treeVersion: ws.treeVersion + 1 },
        },
      };
    }),

  setFileState: (projectId, nodeId, fileState) =>
    set((state) => {
      const ws = state.byProjectId[projectId];
      if (!ws) return state;

      const prev = ws.fileStates[nodeId] || { content: "", isDirty: false };
      const now = Date.now();
      const next = { ...prev, ...fileState, lastAccessedAt: now };
      const contentUnchanged =
        prev.content === next.content &&
        prev.isDirty === next.isDirty &&
        prev.lastSavedAt === next.lastSavedAt;
      if (contentUnchanged && prev.lastAccessedAt && now - prev.lastAccessedAt < 5_000) {
        return state;
      }

      const maxEntries = estimateVisibleRowsBudget(ws);
      const nextFileStates = evictLruIfNeeded({ ...ws.fileStates, [nodeId]: next }, maxEntries);
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            fileStates: nextFileStates,
          },
        },
      };
    }),
});
