"use client";

import React, { useContext, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Github,
  Info,
  Loader2,
  MoreHorizontal,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import { getHeaderGitHubSyncStatus } from "@/app/actions/github-sync";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import {
  fileCollectionViews,
  useFilesWorkspaceView,
} from "./FilesWorkspaceViews";
import { BreadcrumbBar } from "./breadcrumb/BreadcrumbBar";
import type { CurrentLocation } from "./navigation";
import { useFileTransfers } from "./FileTransfers";
import { QuickOpenDialog } from "./quick-open/QuickOpenDialog";

// ponytail: portal only the controls, not their state or mutation handlers.
// Lists and previews retain ownership while sharing one physical header row.
import { FilesHeaderContext, FilesHeaderSlot } from "./FilesHeaderSlot";
export { FilesHeaderSlot } from "./FilesHeaderSlot";

export function FilesWorkspaceHeader({
  projectId,
  location,
  canOpenGitHub = false,
  children,
}: {
  projectId: string;
  location: CurrentLocation | null;
  canOpenGitHub?: boolean;
  children: React.ReactNode;
}) {
  const workspace = useFilesWorkspaceView();
  const transfers = useFileTransfers();
  const collapsed = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui.sidebarCollapsed ?? false,
  );
  const toggleSidebar = useFilesWorkspaceStore((s) => s.toggleSidebar);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<HTMLDivElement | null>(null);
  const collection = fileCollectionViews.find(
    (item) => item.id === workspace?.view,
  );
  const isProject = !workspace || workspace.view === "project";
  const isFile = location?.type === "file";
  const hasLocation = location && location.type !== "root";
  return (
    <FilesHeaderContext.Provider value={{ actions, status, canOpenGitHub }}>
      <header
        data-testid="files-workspace-header"
        className="flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-950"
      >
        {collapsed && (
          <button
            type="button"
            data-testid="files-tab-sidebar-expand"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={() => toggleSidebar(projectId)}
            className="flex size-11 shrink-0 items-center justify-center rounded hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"
          >
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          </button>
        )}
        {isFile && workspace?.query && (
          <button
            type="button"
            aria-label="Back to search results"
            title="Back to search results"
            onClick={workspace.returnToCollection}
            className="flex size-11 shrink-0 items-center justify-center rounded hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        )}
        {isProject && !isFile && workspace?.query ? (
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-2 text-sm"
          >
            <button
              type="button"
              onClick={() => workspace.selectView("project")}
              className="min-w-0 truncate rounded py-2 hover:underline focus-visible:ring-2"
            >
              Project files
            </button>
            <span aria-hidden="true">/</span>
            <span className="min-w-0 truncate">Search results</span>
          </nav>
        ) : isProject ? (
          <BreadcrumbBar projectId={projectId} location={location} />
        ) : (
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-2 text-sm"
          >
            {workspace?.taskId || hasLocation ? (
              <button
                type="button"
                onClick={() => workspace?.selectView(workspace.view)}
                title={collection?.label}
                className="min-w-0 truncate rounded py-2 hover:underline focus-visible:ring-2"
              >
                {collection?.label}
              </button>
            ) : (
              <span className="truncate font-medium">{collection?.label}</span>
            )}
            {workspace?.taskId && (
              <>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  title={workspace.taskTitle || "Task files"}
                  onClick={workspace.returnToCollection}
                  className="min-w-0 truncate rounded py-2 hover:underline focus-visible:ring-2"
                >
                  {workspace.taskTitle || "Task files"}
                </button>
              </>
            )}
            {hasLocation && (
              <>
                <span aria-hidden="true">/</span>
                <span className="min-w-0 truncate" title={location.node.name}>
                  {location.node.name}
                </span>
              </>
            )}
          </nav>
        )}
        {!isFile && workspace?.query && (
          <button
            type="button"
            aria-label={`Clear search: ${workspace.query}`}
            title={`Search: ${workspace.query} — clear`}
            onClick={() => workspace.setQuery("")}
            className="flex min-h-9 max-w-[25%] min-w-0 items-center gap-1 rounded bg-blue-50 px-2 text-xs text-blue-700 focus-visible:ring-2 dark:bg-blue-500/15 dark:text-blue-300"
          >
            <Search className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{workspace.query}</span>
            <X className="size-3 shrink-0" aria-hidden="true" />
          </button>
        )}
        {!isFile && workspace?.taskId && workspace.fileRole !== "all" && (
          <button
            type="button"
            onClick={() => workspace.setFileRole("all")}
            aria-label="Clear file role filter"
            className="flex min-h-9 shrink-0 items-center gap-1 rounded bg-blue-50 px-2 text-xs text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
          >
            {workspace.fileRole === "reference" ? "References" : "Working"}
            <X className="size-3" aria-hidden="true" />
          </button>
        )}
        <div
          ref={setStatus}
          className="flex shrink-0 items-center gap-2 text-xs"
        />
        {canOpenGitHub && (
          <HeaderGitHubSyncButton projectId={projectId} />
        )}
        <div ref={setActions} className="flex shrink-0 items-center gap-1" />
        {!!transfers?.active && <button type="button" onClick={transfers.open} className="min-h-11 shrink-0 rounded px-2 text-xs" aria-label={`Show ${transfers.active} active transfers`}>↑ {transfers.active}</button>}
      </header>
      {children}
    </FilesHeaderContext.Provider>
  );
}

type HeaderStatus = {
  connected: boolean;
  repository: string | null;
  branch: string | null;
  hasIncoming: boolean;
  activeRun: {
    id: string;
    stage: string;
    direction: "push" | "pull";
  } | null;
  latestRunStatus: string | null;
  latestCommitSha?: string | null;
  latestDirection?: "push" | "pull" | null;
  latestSyncAt?: string | null;
  syncComment?: string | null;
};

function HeaderGitHubSyncButton({ projectId }: { projectId: string }) {
  const workspace = useFilesWorkspaceView();
  const [status, setStatus] = useState<HeaderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    let active = true;
    const fetchStatus = () => {
      getHeaderGitHubSyncStatus(projectId)
        .then((res) => {
          if (active && res.success) {
            setStatus(res.data);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    fetchStatus();

    const handleFilesChanged = () => fetchStatus();
    window.addEventListener("project:task-files-changed", handleFilesChanged);

    return () => {
      active = false;
      window.removeEventListener("project:task-files-changed", handleFilesChanged);
    };
  }, [projectId, workspace?.view]);

  if (loading && !status) {
    return null;
  }

  const isGitHubView = workspace?.view === "github";

  if (!status?.connected) {
    return (
      <button
        type="button"
        onClick={() => workspace?.selectView("github")}
        title="Connect GitHub Repository"
        aria-label="Connect GitHub Repository"
        className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors border ${
          isGitHubView
            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
            : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        }`}
      >
        <Github className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">GitHub</span>
      </button>
    );
  }

  const isSyncing = Boolean(status.activeRun);
  const hasIncoming = status.hasIncoming;
  const branchName = status.branch || "main";
  const shortSha = status.latestCommitSha;
  const repoName = status.repository || "workspace";

  const openGitHubSync = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (workspace?.selectView) {
      workspace.selectView("github");
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("path");
      url.searchParams.delete("fileId");
      url.searchParams.delete("filesNav");
      url.searchParams.set("tab", "files");
      url.searchParams.set("filesView", "github");
      window.location.href = url.toString();
    }
  };

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={openGitHubSync}
        aria-label={`GitHub sync status for ${repoName}: ${branchName}${shortSha ? ` (commit ${shortSha})` : ""}`}
        className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors border ${
          isGitHubView
            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
            : hasIncoming
            ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/30 dark:text-amber-300"
            : isSyncing
            ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-600/40 dark:bg-blue-950/30 dark:text-blue-300"
            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        {isSyncing ? (
          <Loader2 className="size-3.5 animate-spin text-blue-600 dark:text-blue-400" />
        ) : (
          <Github className="size-3.5" aria-hidden="true" />
        )}
        <span className="font-mono text-[11px] font-medium">
          {branchName}
        </span>
        {shortSha && !isSyncing && (
          <>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
              commit {shortSha}
            </span>
          </>
        )}
        {hasIncoming && (
          <span className="flex size-1.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-zinc-900 animate-pulse" />
        )}
      </button>

      {/* Rich Professional Hover Popover (Zero DOM-churn, pure CSS visibility) */}
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-80 opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95 space-y-2.5 text-left">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 truncate">
              <Github className="size-3.5 shrink-0 text-zinc-700 dark:text-zinc-300" />
              <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {status.repository}
              </span>
            </div>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isSyncing
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  : hasIncoming
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {isSyncing ? "Syncing..." : hasIncoming ? "Incoming" : "Synced"}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="font-mono text-[10px]">
              Branch: <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{branchName}</strong>
            </span>
            {shortSha && status.repository && (
              <a
                href={`https://github.com/${status.repository}/commit/${shortSha}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400 font-medium"
                onClick={(e) => e.stopPropagation()}
              >
                Commit: {shortSha}
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={openGitHubSync}
            className="flex w-full items-center justify-between border-t border-zinc-100 pt-2 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline dark:border-zinc-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors cursor-pointer group/link"
          >
            <span>Open GitHub Sync workspace</span>
            <span aria-hidden="true" className="transition-transform group-hover/link:translate-x-0.5">&rarr;</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const collectionInfo = {
  github: "Review selected project files before publishing to GitHub or importing changes. Task drafts and Trash are excluded. GitHub permissions and project membership remain separate.",
  project:
    "Project files are stored in folders. Search finds accessible filenames across the project, not just the currently loaded rows. Upload and New use the open folder.",
  tasks:
    "Working files and references are grouped by task. Linked files stay in their original location. Open a task to add or link files with an explicit role.",
  deliverables:
    "Submitted outputs with version-specific review status. New revisions require a new approval; a completed task does not automatically approve every file.",
  recent:
    "Recent files are shortcuts saved in this browser, ordered by when you opened them. Deleted files and files you can no longer access are excluded.",
  starred:
    "Starred files are shortcuts saved in this browser. Star or unstar a file from its actions menu. Deleted files and inaccessible files are excluded.",
  trash:
    "Restore an item and the contents deleted with it. Earlier deletions stay in Trash. Permanent deletion cannot be undone and does not delete anything from GitHub.",
};

export function FilesWorkspaceMenu({
  projectId,
  children,
  selectionMode = false,
}: {
  projectId: string;
  children?: React.ReactNode;
  selectionMode?: boolean;
}) {
  const workspace = useFilesWorkspaceView();
  const transfers = useFileTransfers();
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingSurface = useRef<"search" | "info" | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [surface, setSurface] = useState<"search" | "info" | null>(null);
  const [draft, setDraft] = useState("");
  const view = workspace?.view ?? "project";
  const label = fileCollectionViews.find((item) => item.id === view)!.label;
  const searchLabel = workspace?.taskId
    ? `Search ${workspace.taskTitle || "task files"}`
    : `Search ${label.toLowerCase()}`;
  function closeSurface() {
    setSurface(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <>
      <FilesHeaderSlot>
        {/* The destination dialog owns modality. A modal menu can retain its
          body pointer lock when a dialog opens during the menu exit. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              ref={trigger}
              type="button"
              aria-label={
                selectionMode ? "Selected file actions" : "Files actions"
              }
              title={selectionMode ? "Selected file actions" : "Files actions"}
              data-testid="files-workspace-menu"
              className="flex size-11 items-center justify-center rounded hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={8}
            className="w-56 max-w-[calc(100vw-16px)] [&_[role=menuitem]]:min-h-10 [&_[role=menuitemradio]]:min-h-10"
            onCloseAutoFocus={(event) => {
              if (pendingSurface.current) {
                event.preventDefault();
                setSurface(pendingSurface.current);
                pendingSurface.current = null;
              }
            }}
          >
            {!selectionMode && (
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(workspace?.query ?? "");
                  pendingSurface.current = "search";
                }}
              >
                <Search className="size-4" />
                Search…
              </DropdownMenuItem>
            )}
            {children}
            {!selectionMode && (
              <>
                <DropdownMenuSeparator />
                {transfers && <DropdownMenuItem onSelect={transfers.open}>Transfers…</DropdownMenuItem>}
                <DropdownMenuItem
                  onSelect={() => {
                    pendingSurface.current = "info";
                  }}
                >
                  <Info className="size-4" />
                  About {label.toLowerCase()}…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </FilesHeaderSlot>
      {view === "project" && (
        <QuickOpenDialog
          projectId={projectId}
          open={surface === "search"}
          query={draft}
          onQueryChange={setDraft}
          onOpenChange={(open) => {
            if (!open) closeSurface();
          }}
          includeFolders
          onApplyQuery={(query) => {
            workspace?.setQuery(query);
            closeSurface();
          }}
        />
      )}
      <Dialog
        open={
          surface === "info" || (surface === "search" && view !== "project")
        }
        onOpenChange={(open) => {
          if (!open) closeSurface();
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            if (surface === "search") {
              event.preventDefault();
              searchInput.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          className="max-w-[calc(100vw-2rem)] sm:max-w-lg"
        >
          <DialogTitle>{surface === "info" ? label : searchLabel}</DialogTitle>
          <DialogDescription>
            {surface === "info"
              ? collectionInfo[view]
              : view === "tasks" || view === "deliverables"
                ? workspace?.taskId
                  ? "Find filenames in this task. Your role filter is retained."
                  : "Find tasks by title or their attached filenames."
                : "Find filenames in this collection."}
          </DialogDescription>
          {surface === "search" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                workspace?.setQuery(draft.trim());
                closeSurface();
              }}
              className="space-y-4"
            >
              <label className="block text-sm">
                Search
                <input
                  ref={searchInput}
                  type="search"
                  maxLength={256}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="mt-2 h-11 w-full rounded border bg-transparent px-3 focus-visible:outline-blue-500"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeSurface}
                  className="min-h-10 rounded border px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded bg-blue-600 px-3 text-white"
                >
                  Show results
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
