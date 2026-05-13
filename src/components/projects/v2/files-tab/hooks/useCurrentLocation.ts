// Task 2.2 — `useCurrentLocation(projectId)` for the Files tab v3.
//
// Single-source selector over `currentLocationId` + `nodesById`. Every
// navigation-dependent surface (sidebar highlight, breadcrumb, main area,
// deep-link URL) derives from this hook. See design.md § Supporting Hooks
// / `useCurrentLocation`.
//
// Contract:
//   - returns `null` ONLY when the store has no workspace entry for
//     `projectId` (fresh mount before `ensureProjectWorkspace` runs).
//   - returns `{ type: "root" }` when `currentLocationId === null`.
//   - returns `{ type: "folder" | "file", id, node }` when the id resolves
//     in `nodesById`.
//   - returns `{ type: "root" }` when the id is set but cannot be resolved
//     in `nodesById`. This is the transient race window during deep-link
//     arrival or a cache eviction — the dedicated error paths (Req 6.6,
//     Req 10.5) are the responsibility of the surface that triggered the
//     navigation, not of this read-only selector.
//
// Requirements: Req 1.2, Req 1.3, Req 1.5, Req 6.1.

"use client";

import { useShallow } from "zustand/react/shallow";

import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ProjectWorkspaceState } from "@/stores/filesWorkspaceStore";

import type { CurrentLocation } from "../navigation";

/**
 * Pure selector used by {@link useCurrentLocation}. Exposed so tests can
 * exercise every branch without mounting React.
 */
export function selectCurrentLocation(
  workspace: ProjectWorkspaceState | undefined,
): CurrentLocation | null {
  if (!workspace) return null;

  const id = workspace.currentLocationId;
  if (id === null) return { type: "root" };

  const node = workspace.nodesById[id];
  // Transient race (deep-link arrival / cache not yet populated): fall back
  // to the root view. Surfaces with their own error handling (deep-link
  // resolver, quick open) are responsible for the observable error state
  // per Req 6.6 and Req 10.5.
  if (!node) return { type: "root" };

  if (node.type === "folder") return { type: "folder", id, node };
  return { type: "file", id, node };
}

export function useCurrentLocation(projectId: string): CurrentLocation | null {
  return useFilesWorkspaceStore(
    useShallow((s) => selectCurrentLocation(s.byProjectId[projectId])),
  );
}
