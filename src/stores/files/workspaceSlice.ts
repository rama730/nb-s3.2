import type { StateCreator } from "zustand";
import type { FilesWorkspaceState } from "./types";
import { defaultWorkspace } from "./types";
export interface WorkspaceSlice {
  /**
   * Files tab v3 navigation write path. Coexists with `setSelectedNode`
   * so the Tasks tab's file picker is unaffected (Req 21.7).
   *
   * Atomically (a) sets `currentLocationId`, (b) bumps `selectionVersion`,
   * (c) ensures every ancestor of `nodeId` in `nodesById` is present in
   * `expandedFolderIds` with `true`.
   */
  setCurrentLocation: (projectId: string, nodeId: string | null) => void;
  setDirtyFile: (projectId: string, nodeId: string, dirty: boolean) => void;
  setPendingNavigation: (
    projectId: string,
    pending: { nodeId: string | null } | null,
  ) => void;

  setQuickOpenOpen: (projectId: string, open: boolean) => void;
  toggleSidebar: (projectId: string) => void;

}

export const createWorkspaceSlice: StateCreator<FilesWorkspaceState, [], [], WorkspaceSlice> = (set) => ({
  // Files tab v3: navigation source of truth. Coexists with `setSelectedNode`
  // (Tasks tab continues to read/write `selectedNodeId`). See design.md
  // § Store Changes / ADDED.
  setCurrentLocation: (projectId, nodeId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();

      // Walk the strict ancestor chain of `nodeId` in `nodesById` and
      // collect every folder that should be expanded so the node is
      // visible in the sidebar tree (Req 6.2, 6.3). The node itself is
      // not expanded — only its ancestors — which matches the acceptance
      // criteria phrasing ("every ancestor of `nodeId`").
      //
      // We defend against cycles and dangling parentIds by guarding on a
      // `seen` set; a malformed cache cannot lock the reducer.
      const ancestorIdsToExpand: string[] = [];
      if (nodeId) {
        const seen = new Set<string>([nodeId]);
        const startNode = ws.nodesById[nodeId];
        let cursor: string | null = startNode ? startNode.parentId ?? null : null;
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor);
          const node = ws.nodesById[cursor];
          if (!node) break;
          if (node.type === "folder") {
            ancestorIdsToExpand.push(cursor);
          }
          cursor = node.parentId ?? null;
        }
      }

      const nextExpanded = ancestorIdsToExpand.length > 0
        ? { ...ws.expandedFolderIds }
        : ws.expandedFolderIds;
      let expandedChanged = false;
      for (const id of ancestorIdsToExpand) {
        if (nextExpanded[id] !== true) {
          nextExpanded[id] = true;
          expandedChanged = true;
        }
      }

      const idChanged = ws.currentLocationId !== nodeId;

      // Always write back so a missing workspace entry is initialized
      // (same convention as the rest of the slice). Only bump
      // `selectionVersion` / `treeVersion` when something observable
      // actually changed so memoized selectors stay stable.
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            currentLocationId: nodeId,
            expandedFolderIds: expandedChanged ? nextExpanded : ws.expandedFolderIds,
            selectionVersion: idChanged ? ws.selectionVersion + 1 : ws.selectionVersion,
            treeVersion: expandedChanged ? ws.treeVersion + 1 : ws.treeVersion,
          },
        },
      };
    }),
  setDirtyFile: (projectId, nodeId, dirty) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const dirtyFileId = dirty
        ? nodeId
        : ws.dirtyFileId === nodeId
          ? null
          : ws.dirtyFileId;
      if (dirtyFileId === ws.dirtyFileId && state.byProjectId[projectId]) return state;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, dirtyFileId },
        },
      };
    }),
  setPendingNavigation: (projectId, pending) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      if (
        ws.pendingNavigation?.nodeId === pending?.nodeId &&
        Boolean(ws.pendingNavigation) === Boolean(pending) &&
        state.byProjectId[projectId]
      ) {
        return state;
      }
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: { ...ws, pendingNavigation: pending },
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
});
