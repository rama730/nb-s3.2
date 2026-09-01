// Files main: folder/root renders the list; file renders FileView keyed by id.

"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { useFilesTabRole } from "./FilesTabRoleContext";
import { useCurrentLocation } from "./hooks/useCurrentLocation";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import {
  FilesWorkspaceHeader,
  FilesWorkspaceMenu,
} from "./FilesWorkspaceHeader";
import { FolderListView } from "./folder/FolderListView";
import { FileView } from "./file/FileView";
import { useFilesWorkspaceView } from "./FilesWorkspaceViews";
import { TaskFilesCollection } from "./TaskFilesCollection";
import { SavedFilesCollection } from "./SavedFilesCollection";
import { TrashFilesCollection } from "./TrashFilesCollection";
import { GitHubSyncWorkspace } from "./GitHubSyncWorkspace";
import type { GithubImportAccessState } from "@/lib/github/import-types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilesTabMainProps {
  projectId: string;
  projectName?: string;
  canOpenGitHub?: boolean;
  githubAccess?: GithubImportAccessState | null;
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
  canOpenGitHub,
  githubAccess,
}: FilesTabMainProps): React.JSX.Element {
  const { canEdit, canManageFiles } = useFilesTabRole();
  const location = useCurrentLocation(projectId);
  const workspaceView = useFilesWorkspaceView();
  const isCollection =
    workspaceView &&
    workspaceView.view !== "project" &&
    (!location || location.type === "root");

  // Read the booting state from the explorer context (injected via FilesTabRoot)
  const bootContext = React.useContext(FilesTabBootContext);
  const isBooting = bootContext?.isBooting ?? false;

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
      <FilesWorkspaceHeader
        projectId={projectId}
        location={location}
        canOpenGitHub={canOpenGitHub}
      >
        {!isCollection && (isBooting || unresolved) && (
          <FilesWorkspaceMenu projectId={projectId} />
        )}
        {isCollection ? (
          workspaceView.view === "github" ? (
            <GitHubSyncWorkspace
              projectId={projectId}
              projectName={projectName}
              canManage={!!canOpenGitHub}
              access={githubAccess ?? null}
            />
          ) : workspaceView.view === "tasks" ||
            workspaceView.view === "deliverables" ? (
            <TaskFilesCollection
              key={`${projectId}:${workspaceView.view}:${workspaceView.taskId ?? "all"}`}
              projectId={projectId}
            />
          ) : workspaceView.view === "trash" ? (
            <TrashFilesCollection projectId={projectId} />
          ) : (
            <SavedFilesCollection projectId={projectId} />
          )
        ) : isBooting ? (
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
            canManageFiles={canManageFiles}
          />
        ) : (
          <FileView
            key={location.id}
            projectId={projectId}
            node={location.node}
            canEdit={canEdit}
          />
        )}
      </FilesWorkspaceHeader>
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
      <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
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
