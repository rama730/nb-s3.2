// Task 8.3 — Feature-flag gated entry point for the Files tab.
//
// Per design.md § Migration and Rollout / Coexistence, this file is the
// single entry point consumed by `ProjectTabsRegistry` (and prefetched by
// `ProjectDashboardClient`). It branches on `isFilesTabV3Enabled(currentUserId)`
// and renders **either** the GitHub-style V3 `FilesTabRoot` or the legacy
// `WorkspaceShell`, never both.
//
// Contract points (see tasks.md § 8.3, design.md § Coexistence):
//
//   1. Both subtrees are imported via `next/dynamic(() => import(...), { ssr: false })`.
//      Because `dynamic` only invokes its loader when the element is rendered,
//      the branch that loses the flag check never triggers its `import()`.
//      This is what lets the import-graph test in Task 11.3 assert that
//      `WorkspaceShell` and its removed-features dependencies are not reachable
//      from the V3 build when the flag is on.
//
//   2. `adaptToV3Props` is a pure prop adapter. It drops `initialOpenLine`
//      and `initialOpenColumn` (V3 has no line targeting) and `initialFileNodes`
//      / `importSourceType` (not part of the V3 FilesTabRoot surface), while
//      passing `initialOpenPath` through unchanged. The flag value itself is
//      not adapted — the branch is chosen here, and `adaptToV3Props` is pure
//      with respect to its input.
//
//   3. The legacy branch receives the original props unchanged, so nothing
//      about `WorkspaceShell` behaviour changes while the flag is off.
//
// Requirements: Req 21.7–21.8 (public-surface preservation for out-of-scope
// tabs / shared modules during the rollout).

"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { ProjectNode } from "@/lib/db/schema";
import { isFilesTabV3Enabled } from "@/lib/features/files";

// ─── Lazy subtree loaders ───────────────────────────────────────────
//
// Both loaders are declared at module scope so each branch resolves to a
// stable component reference across renders. `ssr: false` mirrors the
// existing `FilesTab` registration in `ProjectTabsRegistry.tsx`; the Files
// tab is a client-only surface.
//
// IMPORTANT: do NOT collapse these into a single loader. The point of two
// `dynamic` calls is that only the chosen branch triggers its `import()`
// at runtime, which keeps `WorkspaceShell` + its removed-features
// dependency graph out of the flag-on bundle at render time.

const FilesTabRoot = dynamic(
    () => import("./files-tab/FilesTabRoot").then((m) => m.FilesTabRoot),
    { ssr: false },
);

const WorkspaceShell = dynamic(
    () => import("./workspace/WorkspaceShell"),
    { ssr: false },
);

// ─── Props contract ─────────────────────────────────────────────────

export interface ProjectFilesWorkspaceProps {
    projectId: string;
    projectName?: string;
    currentUserId?: string;
    isOwnerOrMember: boolean;
    isActive?: boolean;
    initialFileNodes?: ProjectNode[];
    syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
    importSourceType?: "github" | "upload" | "scratch" | null;
    initialOpenPath?: string | null;
    /** Legacy V2 line-target; V3 has no line targeting and this is dropped. */
    initialOpenLine?: number | null;
    /** Legacy V2 column-target; V3 has no line targeting and this is dropped. */
    initialOpenColumn?: number | null;
}

/**
 * V3 props shape consumed by `FilesTabRoot`. Kept local to this module
 * because the adapter is the single call-site; if the `FilesTabRoot`
 * surface changes, its exported `FilesTabRootProps` remains the source
 * of truth and this type re-derives.
 */
export interface FilesTabV3Props {
    projectId: string;
    projectName?: string;
    currentUserId?: string;
    isOwnerOrMember: boolean;
    isActive?: boolean;
    syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
    initialOpenPath?: string | null;
}

// ─── Prop adapter ───────────────────────────────────────────────────

/**
 * Drops V2-only props (`initialOpenLine`, `initialOpenColumn`,
 * `initialFileNodes`, `importSourceType`) and forwards the rest into the
 * V3 `FilesTabRoot` surface. Pure; exported for the entry-gating test.
 *
 * `initialOpenPath` passes through unchanged so the deep-link fallback
 * wired in `FilesTabRoot` (mount-time `?path=` snapshot; see design.md
 * § FilesTabRoot / Coexistence) continues to honour legacy callers.
 */
export function adaptToV3Props(
    props: ProjectFilesWorkspaceProps,
): FilesTabV3Props {
    return {
        projectId: props.projectId,
        projectName: props.projectName,
        currentUserId: props.currentUserId,
        isOwnerOrMember: props.isOwnerOrMember,
        isActive: props.isActive,
        syncStatus: props.syncStatus,
        initialOpenPath: props.initialOpenPath ?? null,
    };
}

// ─── Component ──────────────────────────────────────────────────────

export default function ProjectFilesWorkspace(
    props: ProjectFilesWorkspaceProps,
): React.JSX.Element {
    // Resolve the flag per-render. `isFilesTabV3Enabled` is deterministic
    // for a given `(env, userId)` tuple (see tests/unit/features/
    // files-tab-v3-flag.test.ts), so repeated evaluation is free from
    // React's perspective — no memoisation required.
    if (isFilesTabV3Enabled(props.currentUserId)) {
        return <FilesTabRoot {...adaptToV3Props(props)} />;
    }
    return <WorkspaceShell {...props} />;
}
