// Task 8.2 — `FilesTabMain` for the Files tab v3.
//
// Contract (see design.md § FilesTabMain and § Metadata Bug Fix):
//
//   * Subscribes to `useCurrentLocation(projectId)` — the single read path
//     fed by `currentLocationId` on the workspace store (Req 6.1).
//
//   * Conditional render (Req 1.2, 1.3, 1.5, 1.6):
//       - `location === null || location.type === "root" | "folder"`
//         → `<FolderListView ...>` with `folderId` set to the current
//           folder id (or `null` for root).
//       - `location.type === "file"`
//         → `<FileView key={location.id} ...>`. The React key forces a
//           full subtree remount on every id change, which is the
//           structural fix for the Req 17 metadata-stale-on-close bug.
//
//   * Req 1.8 — unresolved location:
//     `useCurrentLocation` returns `{ type: "root" }` when
//     `currentLocationId` is set but cannot be resolved in `nodesById`
//     (transient race during deep-link arrival, or cache eviction). We
//     independently detect this case by reading both keys off the store
//     and, if the id is non-null but has no node, render an inline error
//     indicator in the main area in place of the folder list. The
//     Sidebar_Tree is preserved in its current expanded/collapsed state
//     because it lives in `FilesTabRoot` above us.
//
//   * Req 6.4 — dev-only surface-disagreement assertion:
//     In development, compare the terminal id of `ancestorChain(nodesById,
//     currentLocationId)` to the tree highlight id (also `currentLocationId`,
//     since the sidebar is keyed by the same value). If they disagree for
//     any single render, log a `console.warn`. The assertion is omitted
//     from production bundles via the `process.env.NODE_ENV !==
//     "production"` guard (dead-code-eliminated by bundlers). Hooks are
//     still called unconditionally at the top level so no Rules-of-Hooks
//     violations can occur: we call the hook and then no-op inside its
//     effect in production builds.
//
// Requirements: Req 1.2, Req 1.3, Req 1.5–1.8, Req 6.4, Req 17.1–17.4.
// Design references: § FilesTabMain, § Metadata Bug Fix, § Four-Surface
// Synchronization.

"use client";

import * as React from "react";
import { AlertTriangle, PanelLeftOpen } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { useFilesTabRole } from "./FilesTabRoleContext";
import { useCurrentLocation } from "./hooks/useCurrentLocation";
import { ancestorChain } from "./navigation";
import { BreadcrumbBar } from "./breadcrumb/BreadcrumbBar";
import { FolderListView } from "./folder/FolderListView";
import { FileView } from "./file/FileView";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilesTabMainProps {
  projectId: string;
  /**
   * Display name for the project, forwarded to `FolderListView` so the
   * explorer-dialog host can surface the project title in titles/labels.
   */
  projectName?: string;
  /**
   * Whether the Files tab is currently the active project tab. Gates
   * fetches inside `useExplorerBoot` via `FolderListView`. Defaults to
   * `true` so standalone mounts (including tests) fetch.
   */
  isActive?: boolean;
  /** Sync status surfaced to `useExplorerBoot` through `FolderListView`. */
  syncStatus?: string;
}

// Stable empty object used by selectors reading `nodesById` when the
// workspace entry has not been created yet. Keeps Zustand selector
// equality (`Object.is`) stable across renders so we do not trigger
// gratuitous re-renders before the project workspace is hydrated.
const EMPTY_NODES = Object.freeze({}) as Record<string, ProjectNode>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilesTabMain({
  projectId,
  projectName,
  isActive = true,
  syncStatus,
}: FilesTabMainProps): React.JSX.Element {
  const { canEdit } = useFilesTabRole();
  const location = useCurrentLocation(projectId);

  // ── Sidebar collapsed state (Req 18.1–18.6) ──────────────────────
  const sidebarCollapsed = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.sidebarCollapsed ?? false,
  );
  const toggleSidebar = useFilesWorkspaceStore((s) => s.toggleSidebar);

  // Read the raw `currentLocationId` + `nodesById` so we can detect the
  // Req 1.8 "id set but unresolved" case independently of
  // `useCurrentLocation` (which masks it as `{ type: "root" }` to keep
  // the read selector total — surfaces handle their own error UX).
  const currentLocationId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById ?? EMPTY_NODES,
  ) as Record<string, ProjectNode>;

  const unresolved =
    currentLocationId !== null && nodesById[currentLocationId] === undefined;

  // ── Req 6.4: dev-only surface-disagreement assertion ──────────────
  //
  // Four observable surfaces (tree highlight, breadcrumb, main, URL) all
  // derive from `currentLocationId`. The tree highlight id is literally
  // `currentLocationId`, so we compare it to the terminal id of the
  // breadcrumb chain. When the id is unresolved, `ancestorChain` returns
  // `[]` — that is expected and handled by the Req 1.8 branch above, so
  // we skip the assertion in that case to avoid spamming the console for
  // a condition we already surface to the user.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (currentLocationId === null) return; // root state: chain is [], expected
    if (unresolved) return; // Req 1.8 branch handles this
    const chain = ancestorChain(nodesById, currentLocationId);
    const breadcrumbTerminalId = chain.at(-1)?.id ?? null;
    const treeHighlightId = currentLocationId;
    if (breadcrumbTerminalId !== treeHighlightId) {
      console.warn("[files-tab] tree ⇄ breadcrumb disagreement", {
        breadcrumbTerminalId,
        treeHighlightId,
        currentLocationId,
      });
    }
  }, [currentLocationId, nodesById, unresolved]);

  return (
    <div
      data-testid="files-tab-main"
      className="flex-1 flex flex-col min-w-0 h-full relative"
    >
      {/* Sidebar_Reopen_Control — Req 18.1–18.6 */}
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => toggleSidebar(projectId)}
          aria-label="Show sidebar"
          title="Show sidebar"
          data-testid="files-tab-sidebar-expand"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-r-md border border-l-0 border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors"
          style={{ width: 44, height: 44 }}
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}
      <BreadcrumbBar projectId={projectId} location={location} />
      {unresolved ? (
        <LocationNotFound />
      ) : location === null ||
        location.type === "root" ||
        location.type === "folder" ? (
        <FolderListView
          projectId={projectId}
          folderId={
            location && location.type === "folder" ? location.id : null
          }
          canEdit={canEdit}
          projectName={projectName}
          isActive={isActive}
          syncStatus={syncStatus}
        />
      ) : (
        <FileView
          key={location.id}
          projectId={projectId}
          node={location.node}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline: Req 1.8 error indicator
// ---------------------------------------------------------------------------
//
// Rendered when `currentLocationId` is set but the node cannot be resolved
// in `nodesById`. The Sidebar_Tree above us is untouched, so the user can
// still navigate elsewhere. The surface of the error is intentionally
// inline + non-modal — deep-link arrival race (Req 10.5) and mid-session
// cache eviction both land here and both benefit from a preserved tree
// state per Req 1.8.

function LocationNotFound(): React.JSX.Element {
  return (
    <div
      data-testid="files-tab-main-location-not-found"
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
    >
      <AlertTriangle
        className="h-6 w-6 text-amber-500"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        This location could not be found
      </p>
      <p className="max-w-md text-xs text-zinc-500 dark:text-zinc-400">
        The file or folder you requested is no longer available. Pick a
        different item from the sidebar to continue browsing.
      </p>
    </div>
  );
}

export default FilesTabMain;
