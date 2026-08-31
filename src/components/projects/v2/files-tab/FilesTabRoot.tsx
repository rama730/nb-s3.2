// Files tab root: owns boot, URL/deep-link sync, realtime, quick open, and role context.
//
// Responsibilities (per design.md § FilesTabRoot and tasks.md § 8.1):
//
//   1. Ensure the project's workspace entry exists in the files workspace
//      store on mount. `useCurrentLocation` short-circuits to `null` until
//      this runs, so the sidebar/main/breadcrumb would all render empty
//      otherwise.
//   2. Drive the three-stage startup machine via
//      `useFilesTabStartupStage(projectId)`. The stage is exposed on a
//      `data-startup-stage` attribute for integration tests.
//   3. Boot the explorer EXACTLY ONCE at this root by calling
//      `useExplorerBoot(...)` and publishing `loadFolderContent` through
//      `FilesTabBootContext.Provider`. Child subtrees that need per-folder
//      reads (`useFolderContents`) read from the context rather than
//      re-booting; double-booting would double-fire the batch hydration
//      and the paginated root fetch.
//   4. Gate `useDeepLinkResolver(projectId, ...)` on `stage === "main"`
//      per design.md § useDeepLinkResolver. Critically, the resolver reads
//      from a **mount-time snapshot** of `window.location.search` rather
//      than live URL, so the URL sync's root-state stripping (see
//      `useFilesTabUrlSync` Effect 1) cannot race the resolver and erase
//      the `?path=` before it runs. See the `initialSearch` state below
//      for the snapshot logic — it also honours `initialOpenPath` by
//      synthesising a `?path=` fallback when the URL has none.
//   5. Wire `useFilesTabUrlSync(projectId, ...)` so `currentLocationId`
//      mirrors into `?path=` via `history.replaceState` and `popstate`
//      flows through `navigateTo`.
//   6. Register a global `⌘P` / `Ctrl+P` keydown handler that **toggles**
//      the Quick Open dialog per Req 9.1 (open when closed, close-and-
//      discard-input when open). Escape is handled inside
//      `QuickOpenDialog` itself, NOT here.
//   7. Wrap the subtree in `FilesTabRoleProvider` so `FileActionsBar`,
//      `FolderListRow`, and the sidebar context-menu items can read the
//      derived role without prop-drilling. Role derivation is the simple
//      mapping called out in the task description:
//        * no `currentUserId` → `Role_Viewer`
//        * `isOwnerOrMember` truthy → `Role_Owner`
//        * else → `Role_Viewer`
//      Owner/Member distinction is deferred — both receive `canEdit=true`
//      per the design (§ Roles), so collapsing them to `Role_Owner` is
//      safe for role-gated UI in this task.
//   8. Render `FilesTabSidebar` + `FilesTabMain` + `QuickOpenDialog`.
//
// Error surfacing:
//   * Deep-link resolution failures log to `console.log` (inside
//     `useDeepLinkResolver`) and bubble to `onError` here. We forward to a
//     non-blocking toast; the inline main-area error indicator specified
//     by the design is added when `FilesTabMain` gains an error prop in a
//     follow-up task, and is not in scope for 8.1.
//
// Requirements: Req 1.1, Req 1.7, Req 6.1, Req 9.1, Req 10.1, Req 16.4.

"use client";

import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { createClient } from "@/lib/supabase/client";
import { subscribeProjectFilesChannel } from "@/lib/realtime/project-files-channel";
import { getNodeMetadataBatch } from "@/app/actions/files/nodes";

import { useExplorerBoot } from "../explorer/useExplorerBoot";

import {
  FilesTabRoleProvider,
  type Role,
} from "./FilesTabRoleContext";
import { FilesTabSidebar } from "./FilesTabSidebar";
import { FilesTabMain } from "./FilesTabMain";
import { QuickOpenDialog } from "./quick-open/QuickOpenDialog";
import { HydrationProgressBanner } from "@/components/projects/HydrationProgressBanner";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import { useFilesTabStartupStage } from "./hooks/useFilesTabStartupStage";
import { useDeepLinkResolver } from "./hooks/useDeepLinkResolver";
import { useFilesTabUrlSync } from "./hooks/useFilesTabUrlSync";
import { runNavigateTo, useNavigateTo } from "./hooks/useNavigateTo";
import { fetchProjectFileLeases } from "@/lib/files/file-lease-client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FilesWorkspaceViews } from "./FilesWorkspaceViews";
import { FilesWorkspaceGitHubDrawer } from "./navigation/FilesWorkspaceGitHubDrawer";

function showFilesToast(message: string, type: "success" | "error" | "info" | "warning" = "info") {
  if (type === "success") toast.success(message);
  else if (type === "error") toast.error(message);
  else if (type === "warning") toast.warning(message);
  else toast.info(message);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface FilesTabRootProps {
  projectId: string;
  /** Display name for the project, piped through to sidebar + main. */
  projectName?: string;
  /**
   * The authenticated user's id, when present. `undefined` means the
   * visitor is unauthenticated (treated as `Role_Viewer` per the design).
   */
  currentUserId?: string;
  /**
   * Upstream flag indicating the user is either the project owner or a
   * member. Combined with `currentUserId` to derive the Files-tab role.
   */
  isOwnerOrMember: boolean;
  isOwner?: boolean;
  canManageFiles?: boolean;
  canUploadFiles?: boolean;
  canReadTasks?: boolean;
  /**
   * Whether the Files tab is the active project tab. Forwarded to
   * `useExplorerBoot` to gate background fetches. Defaults to `true`.
   */
  isActive?: boolean;
  /** GitHub import / clone sync status, forwarded to the boot hook. */
  syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
  /**
   * Deep-link path (decoded segments joined by `/`). Honoured as a
   * fallback only when the URL has no `?path=` at mount. The V3 URL
   * contract uses per-segment `encodeURIComponent` joined by `/`, so we
   * re-encode segments before feeding this into the resolver.
   */
  initialOpenPath?: string | null;
  /**
   * Stable file-node deep link. Used by project update mentions so a file
   * attachment opens the exact file after the workspace cache is hydrated,
   * while `initialOpenPath` remains the readable/fallback URL contract.
   */
  initialOpenFileId?: string | null;
}

const FILES_WORKSPACE_SCROLL_EVENT = "project:files-workspace-scroll";

// ─── Component ───────────────────────────────────────────────────────

export function FilesTabRoot(props: FilesTabRootProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const {
    projectId,
    projectName,
    currentUserId,
    isOwnerOrMember,
    isOwner = false,
    canManageFiles = false,
    isActive = true,
    syncStatus,
    initialOpenPath,
    initialOpenFileId,
  } = props;
  // ── 1. Ensure the project workspace entry exists ──────────────────
  const ensureProjectWorkspace = useFilesWorkspaceStore(
    (s) => s.ensureProjectWorkspace,
  );
  useEffect(() => {
    ensureProjectWorkspace(projectId);
  }, [ensureProjectWorkspace, projectId]);

  // ── 2. Role derivation ───────────────────────────────────────────
  //
  const role: Role = useMemo<Role>(() => {
    if (!currentUserId) return "Role_Viewer";
    if (isOwner) return "Role_Owner";
    return isOwnerOrMember ? "Role_Member" : "Role_Viewer";
  }, [currentUserId, isOwner, isOwnerOrMember]);
  const canEdit = role !== "Role_Viewer" && props.canUploadFiles !== false;
  const canReadTasks = props.canReadTasks ?? role !== "Role_Viewer";
  const pendingNavigation = useFilesWorkspaceStore(
    (state) => state.byProjectId[projectId]?.pendingNavigation ?? null,
  );
  const confirmPendingNavigation = useCallback(() => {
    if (!pendingNavigation) return;
    const state = useFilesWorkspaceStore.getState();
    const dirtyFileId = state.byProjectId[projectId]?.dirtyFileId ?? null;
    if (dirtyFileId) state.setDirtyFile(projectId, dirtyFileId, false);
    state.setPendingNavigation(projectId, null);
    runNavigateTo(
      {
        setCurrentLocation: state.setCurrentLocation,
        addRecent: state.addRecent,
        getNodeType: (id) => state.byProjectId[projectId]?.nodesById[id]?.type,
      },
      projectId,
      pendingNavigation.nodeId,
    );
  }, [pendingNavigation, projectId]);

  // ── 3. Three-stage startup machine (Req 16.4) ─────────────────────
  const [stage, signalStageComplete] = useFilesTabStartupStage(projectId);

  // ── 4. Single explorer boot + FilesTabBootContext provision ───────
  //
  // Boot the explorer exactly once here and publish folder loaders through
  // context so sidebar/main children cannot double-fetch.
  const { isBooting, accessError, loadFolderContent, handleToggleFolder, handleLoadMore } = useExplorerBoot({
    projectId,
    canEdit,
    isActive,
    syncStatus,
    showToast: showFilesToast,
  });
  useEffect(() => {
    if (!isBooting) signalStageComplete("explorer");
  }, [isBooting, signalStageComplete]);
  const bootContextValue = useMemo(
    () => ({ isBooting, accessError, loadFolderContent, handleToggleFolder, handleLoadMore }),
    [isBooting, accessError, loadFolderContent, handleToggleFolder, handleLoadMore],
  );

  // ── 5. Deep-link snapshot: captured ONCE at mount ─────────────────
  //
  // Why a snapshot instead of reading live URL inside
  // `useDeepLinkResolver`?
  //
  // `useFilesTabUrlSync` Effect 1 writes `history.replaceState` whenever
  // `currentLocationId` changes, including on the initial mount where the
  // id is `null` (root). At root, `planUrlSync` strips `?path=` entirely.
  // That stripping happens BEFORE the stage machine transitions to
  // `"main"` and the deep-link resolver's effect fires, which means the
  // resolver would read a URL that has already been cleared — deep links
  // would silently be lost.
  //
  // By snapping `window.location.search` at mount and feeding it to the
  // resolver via its `window` override, the resolver's input is
  // immutable and the URL-sync stripping is harmless. Popstate handling
  // still uses the live `window` (inside `useFilesTabUrlSync`), so
  // browser back/forward continue to re-resolve from the current URL.
  //
  // This also provides a clean entry point for `initialOpenPath`: when the URL has no `?path=` but the prop is
  // set, we synthesise a `?path=` into the snapshot (re-encoding
  // segments so the V3 URL contract is honoured). The live URL is never
  // touched — `useFilesTabUrlSync` will write it for us once
  // `navigateTo` sets `currentLocationId`.
  const [initialSearch] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const live = window.location.search;
    const params = new URLSearchParams(live.startsWith("?") ? live.slice(1) : live);
    if (params.get("path")) return live;
    if (initialOpenPath && initialOpenPath.length > 0) {
      const encoded = initialOpenPath
        .split("/")
        .filter((seg: string) => seg.length > 0)
        .map((seg: string) => encodeURIComponent(seg))
        .join("/");
      if (encoded.length > 0) {
        // Preserve any other query params the real URL may carry.
        const preserved: string[] = [];
        for (const [key, value] of params.entries()) {
          if (key === "path") continue;
          preserved.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
        preserved.push(`path=${encoded}`);
        return `?${preserved.join("&")}`;
      }
    }
    return live;
  });

  // Pseudo-`Window` handed to `useDeepLinkResolver`. Proxies every other
  // access to the real `window`; only `location.search` is overridden.
  const deepLinkWindow = useMemo<Window | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const realWin = window;
    const snapshotLocation: Location = new Proxy(realWin.location, {
      get(target, prop, receiver) {
        if (prop === "search") return initialSearch;
        return Reflect.get(target, prop, receiver);
      },
    });
    return new Proxy(realWin, {
      get(target, prop, receiver) {
        if (prop === "location") return snapshotLocation;
        return Reflect.get(target, prop, receiver);
      },
    });
  }, [initialSearch]);

  // ── 6. Deep-link resolver (gated on stage === "main") ─────────────
  useDeepLinkResolver(projectId, {
    stage: initialOpenFileId ? "diagnostics" : stage,
    window: deepLinkWindow,
    onError: (failure) => {
      // The hook already logs the failure to `console.log`. Surface a
      // non-blocking toast here so the user sees feedback. The inline
      // main-area error indicator specified by design.md is a follow-up
      // task (`FilesTabMain` does not yet accept an error prop).
      const reason =
        failure.kind === "overlength"
          ? "The deep link is too long."
          : failure.kind === "empty"
            ? "The deep link is empty."
            : "Deep link target not found.";
      toast.error(reason);
    },
  });

  const navigateToInitialFile = useNavigateTo(projectId);
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const initialOpenFileExists = useFilesWorkspaceStore((s) =>
    Boolean(
      initialOpenFileId &&
        s.byProjectId[projectId]?.nodesById[initialOpenFileId]?.type === "file",
    ),
  );
  const handledInitialFileIdRef = useRef<string | null>(null);
  const resolvingInitialFileIdRef = useRef<string | null>(null);
  const [handledInitialFileId, setHandledInitialFileId] = useState<string | null>(null);
  const completeInitialFileResolution = useCallback((fileId: string) => {
    handledInitialFileIdRef.current = fileId;
    setHandledInitialFileId(fileId);
  }, []);

  useEffect(() => {
    if (!initialOpenFileId) {
      handledInitialFileIdRef.current = null;
      resolvingInitialFileIdRef.current = null;
      setHandledInitialFileId(null);
    }
  }, [initialOpenFileId]);

  useEffect(() => {
    if (!initialOpenFileId || !initialOpenFileExists) return;
    if (handledInitialFileIdRef.current === initialOpenFileId) return;
    navigateToInitialFile(initialOpenFileId);
    completeInitialFileResolution(initialOpenFileId);
  }, [
    completeInitialFileResolution,
    initialOpenFileExists,
    initialOpenFileId,
    navigateToInitialFile,
  ]);

  useEffect(() => {
    if (!initialOpenFileId || initialOpenFileExists) return;
    if (handledInitialFileIdRef.current === initialOpenFileId) return;
    if (resolvingInitialFileIdRef.current === initialOpenFileId) return;

    let cancelled = false;
    resolvingInitialFileIdRef.current = initialOpenFileId;

    void getNodeMetadataBatch(projectId, [initialOpenFileId], { includeBreadcrumbs: true })
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          toast.error(result.message || "The requested file is not available.");
          completeInitialFileResolution(initialOpenFileId);
          return;
        }

        const node = result.data.nodes.find((candidate) => candidate.id === initialOpenFileId);
        if (!node || node.type !== "file") {
          toast.error("The requested file is not available or you do not have access.");
          completeInitialFileResolution(initialOpenFileId);
          return;
        }

        upsertNodes(projectId, result.data.nodes);
        navigateToInitialFile(initialOpenFileId);
        completeInitialFileResolution(initialOpenFileId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[files-tab] failed to hydrate initial file target", {
          projectId,
          fileId: initialOpenFileId,
          error,
        });
        toast.error("The requested file is not available or you do not have access.");
        completeInitialFileResolution(initialOpenFileId);
      })
      .finally(() => {
        if (resolvingInitialFileIdRef.current === initialOpenFileId) {
          resolvingInitialFileIdRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    completeInitialFileResolution,
    initialOpenFileExists,
    initialOpenFileId,
    navigateToInitialFile,
    projectId,
    upsertNodes,
  ]);

  useEffect(() => {
    if (stage !== "main" || isBooting) return;
    const raf = requestAnimationFrame(() => signalStageComplete("main"));
    return () => cancelAnimationFrame(raf);
  }, [isBooting, signalStageComplete, stage]);

  // ── 7. URL sync (replaceState mirror + popstate handler) ──────────
  useFilesTabUrlSync(projectId, {
    suspendWrites: Boolean(
      initialOpenFileId &&
        handledInitialFileId !== initialOpenFileId,
    ),
    onPopStateError: () => {
      toast.error("Deep link target not found.");
    },
  });

  // ── 8. Project lease channel + bounded freshness reconciliation ───
  //
  // The only Realtime binding is the project-filtered lease table. File/link
  // state reconciles from the authoritative folder query after mutations and
  // when the visible tab regains focus; this avoids workspace-wide events and
  // dead `project_nodes` subscriptions.
  const setLocks = useFilesWorkspaceStore((s) => s.setLocks);
  const currentLocationId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const currentLocationNode = useFilesWorkspaceStore(
    (s) => currentLocationId
      ? s.byProjectId[projectId]?.nodesById[currentLocationId] ?? null
      : null,
  );
  const visibleFolderId = currentLocationNode?.type === "folder"
    ? currentLocationNode.id
    : currentLocationNode?.parentId ?? null;

  useEffect(() => {
    if (!isActive) return;
    const supabase = createClient();
    let reconcileTimer: number | null = null;
    let disposed = false;

    const reconcileLocks = () => {
      if (reconcileTimer) window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(() => {
        void fetchProjectFileLeases(projectId)
          .then((locks) => setLocks(projectId, locks))
          .catch((error) => console.warn("[files-tab] failed to reconcile file leases", error));
      }, 100);
    };

    const channel = subscribeProjectFilesChannel(supabase, {
      projectId,
      onFileLeaseChange: reconcileLocks,
      onStatus: (status) => {
        if (status === "SUBSCRIBED") reconcileLocks();
      },
    });

    const reconcileVisibleFolder = () => {
      if (disposed || document.visibilityState !== "visible") return;
      void loadFolderContent(visibleFolderId, "refresh").catch((error) => {
        console.warn("[files-tab] failed to reconcile visible folder", error);
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileVisibleFolder();
    };
    const onFilesChanged = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId !== projectId) return;
      for (const collection of ["files-task-collections", "files-trash", "files-saved-collection", "files-directory", "files-picker", "files-picker-recent", "files-quick-open", "files-quick-open-recent"]) void queryClient.invalidateQueries({ queryKey: [collection, projectId] });
      reconcileVisibleFolder();
    };
    window.addEventListener("focus", reconcileVisibleFolder);
    window.addEventListener("project:task-files-changed", onFilesChanged);
    window.addEventListener("online", reconcileVisibleFolder);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const folderReconciliation = window.setInterval(reconcileVisibleFolder, 60_000);
    const expirySweep = window.setInterval(() => {
      const current = useFilesWorkspaceStore.getState().byProjectId[projectId]?.locksByNodeId ?? {};
      const locks = Object.values(current);
      if (locks.some((lock) => lock.expiresAt <= Date.now())) {
        setLocks(projectId, locks.filter((lock) => lock.expiresAt > Date.now()));
      }
    }, 5_000);

    return () => {
      disposed = true;
      if (reconcileTimer) window.clearTimeout(reconcileTimer);
      window.clearInterval(expirySweep);
      window.clearInterval(folderReconciliation);
      window.removeEventListener("focus", reconcileVisibleFolder);
      window.removeEventListener("project:task-files-changed", onFilesChanged);
      window.removeEventListener("online", reconcileVisibleFolder);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [projectId, isActive, loadFolderContent, setLocks, visibleFolderId, queryClient]);

  // ── 9. Quick Open state + ⌘P / Ctrl+P toggle (Req 9.1) ────────────
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");

  const handleQuickOpenChange = useCallback((next: boolean) => {
    setQuickOpenOpen(next);
    if (!next) setQuickOpenQuery(""); // Req 9.7 discards input on close
  }, []);

  const handleWorkspaceScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    window.dispatchEvent(new CustomEvent(FILES_WORKSPACE_SCROLL_EVENT, {
      detail: { projectId, scrollTop: target.scrollTop },
    }));
  }, [projectId]);

  // Use a ref so the listener identity stays stable across renders; the
  // ref carries the freshest `open` value without re-binding the handler.
  const quickOpenOpenRef = useRef(quickOpenOpen);
  useEffect(() => {
    quickOpenOpenRef.current = quickOpenOpen;
  }, [quickOpenOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "p") return;
      // Don't steal the shortcut when the user is editing inside a
      // content-editable region or a form field outside Quick Open. This
      // matches the legacy WorkspaceKeyboard behaviour which the browser
      // default (print dialog) also overrides.
      const target = e.target as HTMLElement | null;
      if (target) {
        const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        const isEditable = target.isContentEditable || target.getAttribute("contenteditable") === "true";
        if (isInput || isEditable) return;
      }

      e.preventDefault();
      const wasOpen = quickOpenOpenRef.current;
      if (wasOpen) {
        handleQuickOpenChange(false);
      } else {
        setQuickOpenQuery("");
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleQuickOpenChange]);

  // ── 10. Render ─────────────────────────────────────────────────────
  return (
    <FilesTabBootContext.Provider value={bootContextValue}>
      <FilesTabRoleProvider role={role} canEdit={canEdit} canManageFiles={canManageFiles} canReadTasks={canReadTasks}>
        <FilesWorkspaceViews projectId={projectId} canReadTasks={canReadTasks}>
        <div
          data-testid="files-tab-root"
          data-startup-stage={stage}
          onScrollCapture={handleWorkspaceScroll}
          className="relative flex h-full min-h-0 w-full"
        >
          <HydrationProgressBanner projectId={projectId} />
          <FilesTabSidebar
            projectId={projectId}
            canEdit={canEdit}
            canManageFiles={canManageFiles}
            projectName={projectName}
          />
          <FilesTabMain
            projectId={projectId}
            canOpenGitHub={isOwner}
          />
          <FilesWorkspaceGitHubDrawer projectId={projectId} enabled={isOwner} />
          <QuickOpenDialog
            projectId={projectId}
            open={quickOpenOpen}
            query={quickOpenQuery}
            onQueryChange={setQuickOpenQuery}
            onOpenChange={handleQuickOpenChange}
          />
          <ConfirmDialog
            open={Boolean(pendingNavigation)}
            onOpenChange={(open) => {
              if (!open) {
                useFilesWorkspaceStore
                  .getState()
                  .setPendingNavigation(projectId, null);
              }
            }}
            title="Discard unsaved changes?"
            description="Your edits have not been saved. Discard them and open the selected location?"
            confirmLabel="Discard and open"
            variant="destructive"
            onConfirm={confirmPendingNavigation}
          />
        </div>
        </FilesWorkspaceViews>
      </FilesTabRoleProvider>
    </FilesTabBootContext.Provider>
  );
}

export default FilesTabRoot;
