// Task 2.6 — `useFolderContents(projectId, folderId)`.
//
// Wraps the `childrenByParentId` selector plus the `loadFolderContent` action
// from `useExplorerBoot` into a thin `{ status, children, retry }` façade that
// `FolderListView` (Task 5) can consume without reaching into the boot hook
// itself. See design.md § FolderListView.
//
// The hook is split into three pieces:
//   - `deriveFolderContents` — a pure function that maps an explicit
//     workspace snapshot into `{ status, children, retry }`. Unit-testable
//     without React.
//   - `runFolderLoad` — a pure async coordinator that invokes the loader,
//     toggles error state, and respects a stale-request guard. Unit-testable
//     without React.
//   - `useFolderContents` — the React wrapper that subscribes to the files
//     workspace store, reads the loader from `FilesTabBootContext`, and
//     triggers an auto-load when the folder has not been fetched yet.
//
// The loader is injected via a React context (`FilesTabBootContext`) rather
// than consumed by calling `useExplorerBoot` here. Re-invoking the boot hook
// per folder subtree would double-boot the explorer and fire duplicate batch
// hydrations. `FilesTabRoot` (Task 8.1) will call `useExplorerBoot` exactly
// once at the top of the tree and provide the loader through the context.

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

// ─── Public types ────────────────────────────────────────────────────

export type FolderContentsStatus = "loading" | "ready" | "error";

export interface FolderContents {
  status: FolderContentsStatus;
  children: ProjectNode[];
  retry: () => void;
  refreshError?: boolean;
}

export type LoadFolderContent = (
  parentId: string | null,
  mode?: "refresh" | "append",
) => Promise<void>;

/**
 * Context shape carrying the folder loader down from `FilesTabRoot` to
 * descendants that need per-folder reads. The boot lifecycle still lives in
 * `useExplorerBoot`; this context is purely a typed handoff so we do not
 * re-boot the explorer inside every folder view.
 */
export interface FilesTabBootContextValue {
  loadFolderContent: LoadFolderContent;
  isBooting: boolean;
  accessError: string | null;
  handleToggleFolder: (node: ProjectNode) => Promise<void>;
  handleLoadMore: (folderId: string | null) => void;
}

export const FilesTabBootContext = createContext<FilesTabBootContextValue | null>(null);

// ─── Pure core (unit-testable without React) ─────────────────────────

export interface DeriveFolderContentsInput {
  /** `ws.loadedChildren[parentKey(folderId)]`. `true` means refresh completed. */
  loaded: boolean | undefined;
  /** `ws.childrenByParentId[parentKey(folderId)]` or an empty list. */
  childIds: readonly string[];
  /** `ws.nodesById`. Children missing from this map are filtered out. */
  nodesById: Record<string, ProjectNode>;
  /** Local error flag managed by the hook (sticky until retry). */
  hasError: boolean;
  /** Retry callback surfaced unchanged on the result. */
  retry: () => void;
}

/**
 * Pure derivation of `{ status, children, retry }` from an explicit snapshot.
 *
 * Status precedence:
 *   - `hasError` wins over everything (Req 4.10 — error state renders Retry
 *     regardless of whether stale children happen to be in the cache).
 *   - `!loaded` ⇒ "loading" (Req 4.9 — header + spinner row until refresh
 *     completes).
 *   - Otherwise ⇒ "ready".
 *
 * Children ids missing from `nodesById` are silently filtered so a stale
 * `childrenByParentId` entry cannot crash the list (the store's LRU eviction
 * in `enforceNodesBudget` can legitimately orphan a child id).
 */
export function deriveFolderContents(input: DeriveFolderContentsInput): FolderContents {
  const cached = input.childIds.flatMap(id => input.nodesById[id] ? [input.nodesById[id]!] : []);
  if (input.hasError) {
    return cached.length > 0
      ? { status: "ready", children: cached, retry: input.retry, refreshError: true }
      : { status: "error", children: [], retry: input.retry };
  }
  if (!input.loaded || cached.length !== input.childIds.length) {
    return { status: "loading", children: [], retry: input.retry };
  }
  return { status: "ready", children: cached, retry: input.retry };
}

// ─── Retry coordinator (unit-testable without React) ─────────────────

export interface RunFolderLoadArgs {
  /** The folder loader under test — typically `useExplorerBoot().loadFolderContent`. */
  load: LoadFolderContent;
  /** `null` = project root. Passed verbatim to `load`. */
  folderId: string | null;
  /**
   * Called at most once when the load rejects AND the caller is still the
   * most recent requester for this folder. A stale-request guard lives on
   * the caller side (see `useFolderContents` request-id ref) so a slow
   * in-flight load for folder A cannot flip folder B's error flag when it
   * resolves after navigation.
   */
  onError: () => void;
  /**
   * Invoked with `true` before the load starts (to clear any prior error)
   * and with `false` is NOT done here — the caller manages the error reset
   * on its own so external changes (folder switch, manual retry) can also
   * clear the flag. Supplying `null` disables the reset step; used when the
   * caller wants to decide reset timing itself.
   */
  onBeforeLoad: (() => void) | null;
  /**
   * Predicate that returns `true` iff the invocation is still relevant
   * (no newer load has been started for the same hook instance). When it
   * returns `false` the error path silently drops.
   */
  isStillCurrent: () => boolean;
}

export async function runFolderLoad(args: RunFolderLoadArgs): Promise<void> {
  args.onBeforeLoad?.();
  try {
    await args.load(args.folderId, "refresh");
  } catch {
    if (args.isStillCurrent()) {
      args.onError();
    }
  }
}

// ─── React hook ──────────────────────────────────────────────────────

// Stable empty references keep selectors from triggering re-renders on every
// store write. Zustand compares selector output with `Object.is`.
const EMPTY_IDS: readonly string[] = Object.freeze([]);
const EMPTY_NODES: Record<string, ProjectNode> = Object.freeze({}) as Record<string, ProjectNode>;

export function useFolderContents(
  projectId: string,
  folderId: string | null,
  enabled = true,
): FolderContents {
  const key = filesParentKey(folderId);

  // Narrow selectors so the hook re-renders only when the relevant slice of
  // the project workspace changes, not on every unrelated write.
  const childIds = useFilesWorkspaceStore(
    (s) =>
      (s.byProjectId[projectId]?.childrenByParentId[key] ?? EMPTY_IDS) as readonly string[],
  );
  const loaded = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren[key] === true,
  );
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById ?? EMPTY_NODES,
  );

  const boot = useContext(FilesTabBootContext);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const requestedRetry = useRef(0);
  const complete = loaded && childIds.every(id => Boolean(nodesById[id]));
  const loadFolderContent = boot?.loadFolderContent;
  const isBooting = boot?.isBooting;

  // Reset the transient error whenever the target folder changes so an
  // unrelated folder does not inherit a prior failure.
  useEffect(() => {
    setHasError(false);
  }, [folderId]);

  const retry = useCallback(() => {
    setHasError(false);
    setRetryCount(count => count + 1);
  }, []);

  // Each load belongs to this effect instance. Cleanup marks it stale before
  // another folder or retry can settle, so an old request cannot change the
  // error state of the newly selected folder.
  useEffect(() => {
    if (!enabled || !loadFolderContent || isBooting || (complete && requestedRetry.current === retryCount) || hasError) return;
    let cancelled = false;
    requestedRetry.current = retryCount;
    void loadFolderContent(folderId, "refresh")
      .catch(() => {
        if (!cancelled) setHasError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadFolderContent, isBooting, folderId, retryCount, hasError, complete]);

  // Memoize so consumers get a stable `FolderContents` reference when the
  // underlying inputs have not moved. The `children` array is rebuilt each
  // time `childIds` or `nodesById` changes, which is the minimum required
  // for React's list reconciler to notice additions / removals.
  return useMemo(
    () =>
      deriveFolderContents({
        loaded,
        childIds,
        nodesById,
        hasError,
        retry,
      }),
    [loaded, childIds, nodesById, hasError, retry],
  );
}
