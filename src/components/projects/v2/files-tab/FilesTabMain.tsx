// Files main: folder/root renders the list; file renders FileView keyed by id.

"use client";

import * as React from "react";
import { AlertTriangle, PanelLeftOpen, Loader2 } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { useFilesTabRole } from "./FilesTabRoleContext";
import { useCurrentLocation } from "./hooks/useCurrentLocation";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import { BreadcrumbBar } from "./breadcrumb/BreadcrumbBar";
import { FolderListView } from "./folder/FolderListView";
import { FileView } from "./file/FileView";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilesTabMainProps {
  projectId: string;
  onToggleGitHubSync?: () => void;
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
  onToggleGitHubSync,
}: FilesTabMainProps): React.JSX.Element {
  const { canEdit } = useFilesTabRole();
  const location = useCurrentLocation(projectId);

  // Read the booting state from the explorer context (injected via FilesTabRoot)
  const bootContext = React.useContext(FilesTabBootContext);
  const isBooting = bootContext?.isBooting ?? false;

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
      <BreadcrumbBar projectId={projectId} location={location} onToggleGitHubSync={onToggleGitHubSync} />
      {isBooting ? (
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          data-testid="files-tab-main-loading"
          className="flex flex-1 items-center justify-center gap-2 p-8 text-zinc-500"
        >
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400 dark:text-zinc-500" />
          <span>Loading workspace...</span>
        </div>
      ) : unresolved ? (
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
