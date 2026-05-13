// Task 8.1 — `FilesTabRoot` for the Files tab v3 (GitHub redesign).
//
// Replaces `WorkspaceShell` as the top-level Files-tab entry point behind
// the `filesTabV3Enabled` feature flag. This module owns the top-level
// mount sequence and the wiring between the four observable surfaces
// (sidebar tree, breadcrumb, main area, URL) defined in design.md
// § Component Tree / § Data Flow.
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
//      and `getProjectTreeFlat` fetch.
//   4. Gate `useDeepLinkResolver(projectId, ...)` on `stage === "main"`
//      per design.md § useDeepLinkResolver. Critically, the resolver reads
//      from a **mount-time snapshot** of `window.location.search` rather
//      than live URL, so the URL sync's root-state stripping (see
//      `useFilesTabUrlSync` Effect 1) cannot race the resolver and erase
//      the `?path=` before it runs. See the `initialSearch` state below
//      for the snapshot logic — it also honours the legacy
//      `initialOpenPath` prop by synthesising a `?path=` fallback when the
//      URL has none (design.md § Coexistence / `adaptToV3Props`).
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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useToast } from "@/components/ui-custom/Toast";

import { useExplorerBoot } from "../explorer/useExplorerBoot";

import {
  FilesTabRoleProvider,
  type Role,
} from "./FilesTabRoleContext";
import { FilesTabSidebar } from "./FilesTabSidebar";
import { FilesTabMain } from "./FilesTabMain";
import { QuickOpenDialog } from "./quick-open/QuickOpenDialog";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import { useFilesTabStartupStage } from "./hooks/useFilesTabStartupStage";
import { useDeepLinkResolver } from "./hooks/useDeepLinkResolver";
import { useFilesTabUrlSync } from "./hooks/useFilesTabUrlSync";

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
  /**
   * Whether the Files tab is the active project tab. Forwarded to
   * `useExplorerBoot` to gate background fetches. Defaults to `true`.
   */
  isActive?: boolean;
  /** GitHub import / clone sync status, forwarded to the boot hook. */
  syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
  /**
   * Legacy deep-link path (decoded segments joined by `/`). Honoured as a
   * fallback only when the URL has no `?path=` at mount. The V3 URL
   * contract uses per-segment `encodeURIComponent` joined by `/`, so we
   * re-encode segments before feeding this into the resolver. The
   * `initialOpenLine` / `initialOpenColumn` legacy props are intentionally
   * dropped — V3 has no line targeting.
   */
  initialOpenPath?: string | null;
}

// ─── Component ───────────────────────────────────────────────────────

export function FilesTabRoot(props: FilesTabRootProps): React.JSX.Element {
  const {
    projectId,
    projectName,
    currentUserId,
    isOwnerOrMember,
    isActive = true,
    syncStatus,
    initialOpenPath,
  } = props;

  const { showToast } = useToast();

  // ── 1. Ensure the project workspace entry exists ──────────────────
  const ensureProjectWorkspace = useFilesWorkspaceStore(
    (s) => s.ensureProjectWorkspace,
  );
  useEffect(() => {
    ensureProjectWorkspace(projectId);
  }, [ensureProjectWorkspace, projectId]);

  // ── 2. Role derivation ───────────────────────────────────────────
  //
  // Owner/Member distinction is not available at this boundary — the
  // upstream `isOwnerOrMember` collapses both. Per design.md § Roles,
  // `canEdit = true` for both, so collapsing to `Role_Owner` is safe for
  // role-gated UI. Viewer is the floor for unauthenticated visitors.
  const role: Role = useMemo<Role>(() => {
    if (!currentUserId) return "Role_Viewer";
    return isOwnerOrMember ? "Role_Owner" : "Role_Viewer";
  }, [currentUserId, isOwnerOrMember]);
  const canEdit = role !== "Role_Viewer";

  // ── 3. Three-stage startup machine (Req 16.4) ─────────────────────
  const stage = useFilesTabStartupStage(projectId);

  // ── 4. Single explorer boot + FilesTabBootContext provision ───────
  //
  // `useExplorerBoot` is re-entrant — calling it in multiple subtrees
  // produces duplicate batch fetches because each instance owns its own
  // `bootedRef`. To avoid that, we call it exactly once here and hand
  // `loadFolderContent` down through `FilesTabBootContext` for future
  // consumers (`useFolderContents`). Today's `FilesTabSidebar` and
  // `FolderListView` still call `useExplorerBoot` themselves — that is a
  // pre-existing audit item flagged in tasks.md § 8.1, to be reconciled
  // in follow-up tasks.
  const { loadFolderContent } = useExplorerBoot({
    projectId,
    canEdit,
    isActive,
    syncStatus,
    showToast,
  });
  const bootContextValue = useMemo(
    () => ({ loadFolderContent }),
    [loadFolderContent],
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
  // This also provides a clean entry point for the legacy
  // `initialOpenPath` prop: when the URL has no `?path=` but the prop is
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
        .filter((seg) => seg.length > 0)
        .map((seg) => encodeURIComponent(seg))
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
    stage,
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
      showToast(reason, "error");
    },
  });

  // ── 7. URL sync (replaceState mirror + popstate handler) ──────────
  useFilesTabUrlSync(projectId, {
    onPopStateError: () => {
      showToast("Deep link target not found.", "error");
    },
  });

  // ── 8. Quick Open state + ⌘P / Ctrl+P toggle (Req 9.1) ────────────
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");

  const handleQuickOpenChange = useCallback((next: boolean) => {
    setQuickOpenOpen(next);
    if (!next) setQuickOpenQuery(""); // Req 9.7 discards input on close
  }, []);

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

  // ── 9. Render ─────────────────────────────────────────────────────
  return (
    <FilesTabBootContext.Provider value={bootContextValue}>
      <FilesTabRoleProvider role={role} canEdit={canEdit}>
        <div
          data-testid="files-tab-root"
          data-startup-stage={stage}
          className="flex h-full min-h-0 w-full"
        >
          <FilesTabSidebar
            projectId={projectId}
            role={role}
            canEdit={canEdit}
            projectName={projectName}
            syncStatus={syncStatus}
            isActive={isActive}
          />
          <FilesTabMain
            projectId={projectId}
            projectName={projectName}
            isActive={isActive}
            syncStatus={syncStatus}
          />
          <QuickOpenDialog
            projectId={projectId}
            open={quickOpenOpen}
            query={quickOpenQuery}
            onQueryChange={setQuickOpenQuery}
            onOpenChange={handleQuickOpenChange}
          />
        </div>
      </FilesTabRoleProvider>
    </FilesTabBootContext.Provider>
  );
}

export default FilesTabRoot;
