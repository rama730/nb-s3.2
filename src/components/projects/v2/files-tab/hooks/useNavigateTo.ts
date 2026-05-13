// Task 2.3 — `useNavigateTo(projectId)` is the SINGLE write path to
// `currentLocationId` for the Files tab v3. Every navigation surface (tree
// row click, breadcrumb segment, folder row, quick open, deep-link
// resolver, popstate) funnels through this hook so the four downstream
// surfaces (tree highlight, breadcrumb, main area, URL) cannot diverge.
//
// See design.md § Supporting Hooks / `useNavigateTo` and § Data Flow.
//
// Responsibilities (per tasks.md § 2.3):
//   (a) call `setCurrentLocation(projectId, nodeId)`
//   (b) expand every ancestor of `nodeId` in `expandedFolderIds`
//   (c) when `nodeId` resolves to a file, call `addRecent(projectId, nodeId)`
//
// (b) is satisfied by `setCurrentLocation` itself (Task 1.4 —
// `src/stores/files/workspaceSlice.ts`): the action walks the strict
// ancestor chain and records each ancestor folder in `expandedFolderIds`.
// This hook therefore does not duplicate that traversal; it just delegates.
//
// Requirements: Req 6.1, Req 6.2, Req 6.3, Req 8.4.
//
// The implementation is split into two pieces:
//   * `runNavigateTo` — pure function capturing the side-effect sequence.
//     Unit-testable without a React renderer; same pattern used by
//     `useFolderContents.runFolderLoad` and `useCurrentLocation.selectCurrentLocation`.
//   * `useNavigateTo` — thin React hook that reads the store actions via
//     `useFilesWorkspaceStore.getState()` and wraps `runNavigateTo` in a
//     `useCallback` keyed strictly on `projectId`. This yields callback
//     identity stability across re-renders while always observing the
//     freshest `nodesById` at invocation time.

"use client";

import { useCallback } from "react";

import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

export type NavigateTo = (nodeId: string | null) => void;

// ─── Pure core (unit-testable without React) ─────────────────────────

/**
 * Injectable seams used by {@link runNavigateTo}. Kept narrow on purpose so
 * tests can stub only what they need and do not need to reconstruct a full
 * files workspace state.
 */
export interface NavigateToDeps {
  /** Store action — coexists with legacy `setSelectedNode` (Req 21.7). */
  setCurrentLocation: (projectId: string, nodeId: string | null) => void;
  /** Store action — records a file id at the top of the recents list. */
  addRecent: (projectId: string, nodeId: string) => void;
  /**
   * Resolves `nodeId` to its type, or `undefined` when the node is not in
   * the cache (deep-link arrival race, cache eviction, or an invalid id).
   * Only `"file"` triggers the recents side-effect (Req 8.4); folders and
   * unresolved ids are recorded in the URL / selection but never count as
   * a "recently opened file".
   */
  getNodeType: (nodeId: string) => "file" | "folder" | undefined;
}

/**
 * Pure navigation side-effect sequence. See the module header for the
 * responsibility breakdown.
 *
 * Order is intentional: `setCurrentLocation` first, `addRecent` second.
 * Recents are a secondary breadcrumb trail — if recording them were to
 * throw, the primary navigation must have already completed so the user
 * still lands on the target.
 */
export function runNavigateTo(
  deps: NavigateToDeps,
  projectId: string,
  nodeId: string | null,
): void {
  // (a) + (b): `setCurrentLocation` writes `currentLocationId` and expands
  // every ancestor of `nodeId`. See `workspaceSlice.ts`.
  deps.setCurrentLocation(projectId, nodeId);

  // (c): navigating to the project root (`nodeId === null`) is not a file
  // open, so we do not record a recent.
  if (nodeId === null) return;

  // Only file opens count as recents. Folders update `currentLocationId`
  // and the URL but never the recents list (Req 8.4).
  if (deps.getNodeType(nodeId) === "file") {
    deps.addRecent(projectId, nodeId);
  }
}

// ─── React hook ──────────────────────────────────────────────────────

/**
 * The only write path to `currentLocationId` in the Files tab v3.
 *
 * Returns a callback whose identity is stable across re-renders for as
 * long as `projectId` does not change. This lets consumers pass it into
 * `React.memo` children and event handlers without triggering spurious
 * re-renders downstream.
 *
 * Store reads happen via `useFilesWorkspaceStore.getState()` at invocation
 * time, not via `useFilesWorkspaceStore(...)` selectors. This has two
 * deliberate effects:
 *   1. The callback's identity does NOT depend on the current store
 *      snapshot, so unrelated store writes (e.g. `upsertNodes` during
 *      hydration) do not invalidate the memoized callback.
 *   2. Every invocation reads the freshest `nodesById` — important for
 *      navigation-to-just-created-file flows where the node was inserted
 *      by an earlier action in the same synchronous tick.
 */
export function useNavigateTo(projectId: string): NavigateTo {
  return useCallback<NavigateTo>(
    (nodeId) => {
      const state = useFilesWorkspaceStore.getState();
      runNavigateTo(
        {
          setCurrentLocation: state.setCurrentLocation,
          addRecent: state.addRecent,
          getNodeType: (id) => state.byProjectId[projectId]?.nodesById[id]?.type,
        },
        projectId,
        nodeId,
      );
    },
    [projectId],
  );
}
