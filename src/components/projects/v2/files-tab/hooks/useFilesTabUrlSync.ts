// Task 2.4 — `useFilesTabUrlSync(projectId)`.
//
// Mirrors `currentLocationId` into the URL's `?path=` parameter and responds
// to browser back/forward by re-resolving from the URL. See design.md
// § useFilesTabUrlSync / § URL Contract.
//
// Contract:
//   * ONLY `history.replaceState` is called — never `pushState` (Req 10.4).
//   * Root state (`currentLocationId === null`) writes a URL WITHOUT any
//     `?path=` key — NOT an empty-value `?path=`.
//   * The write is suppressed when the encoded path already matches what is
//     in the URL. Prevents an infinite feedback loop when `popstate` is the
//     event that set the store's current location.
//   * On `popstate`, re-read `window.location.search` and dispatch
//     `navigateTo` with whatever the current URL resolves to. Deep-link
//     resolution (including the >4096 validation and inline-error handling)
//     lives in `useDeepLinkResolver` and is re-used here via
//     `resolveDeepLinkFromSearch`.

"use client";

import { useEffect, useRef } from "react";

import type { ProjectNode } from "@/lib/db/schema";

import { planUrlSync, encodePath } from "../url";
import { useCurrentLocation } from "./useCurrentLocation";
import {
  resolveDeepLinkFromSearch,
  type ResolveDeepLinkDeps,
  type ResolveDeepLinkResult,
} from "./useDeepLinkResolver";
import { useNavigateTo, type NavigateTo } from "./useNavigateTo";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

// ─── Pure/imperative helpers (tested without React) ──────────────────

/**
 * Minimal subset of the DOM Location API the helpers read. Kept explicit so
 * unit tests can stub it without pulling in jsdom.
 */
export interface UrlSyncLocationView {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Minimal subset of the DOM History API the helpers write. Only
 * `replaceState` is called; `pushState` is intentionally omitted from this
 * interface so the single-write-path invariant is enforced by the type.
 */
export interface UrlSyncHistoryView {
  state: unknown;
  replaceState(state: unknown, unused: string, url?: string | null): void;
}

export interface SyncUrlWindow {
  location: UrlSyncLocationView;
  history: UrlSyncHistoryView;
}

export interface SyncUrlToLocationArgs {
  /** Browser `window` reference. Injectable so tests use a stub. */
  win: SyncUrlWindow;
  /** `encodePath(nodesById, currentLocationId)` output. Empty string = root. */
  encodedPath: string;
}

/**
 * Apply the single allowed URL mutation for the Files tab: `replaceState`
 * with a URL that reflects `encodedPath`. No-ops when the URL already
 * matches.
 *
 * Returns `true` when a `replaceState` call was made, `false` otherwise.
 */
export function syncUrlToLocation(args: SyncUrlToLocationArgs): boolean {
  const plan = planUrlSync({
    pathname: args.win.location.pathname,
    search: args.win.location.search,
    hash: args.win.location.hash,
    encodedPath: args.encodedPath,
  });
  if (plan.action === "noop") return false;
  args.win.history.replaceState(args.win.history.state ?? null, "", plan.url);
  return true;
}

export interface PopStateWindow {
  location: UrlSyncLocationView;
}

export interface HandlePopStateArgs extends ResolveDeepLinkDeps {
  /** Browser `window` reference. Injectable so tests use a stub. */
  win: PopStateWindow;
  /** Called with the resolved node id (or null for root). */
  navigateTo: NavigateTo;
  /**
   * Called when resolution fails (empty / overlength / not_found) so the
   * root `FilesTabRoot` can render the inline error per Req 10.5. NOT
   * invoked for the `none` branch (no `?path=` present is the normal root
   * state, not an error).
   */
  onError: (
    failure: Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>,
  ) => void;
}

/**
 * Respond to a `popstate` event by re-reading the URL and dispatching
 * `navigateTo`. Uses the same resolver as `useDeepLinkResolver` so the two
 * surfaces cannot diverge on validation rules.
 */
export async function handlePopState(args: HandlePopStateArgs): Promise<void> {
  const search = args.win.location.search;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const raw = params.get("path");

  const result = await resolveDeepLinkFromSearch(raw, args);
  switch (result.kind) {
    case "ok":
      args.navigateTo(result.nodeId);
      return;
    case "none":
      // URL has no `?path=` — this is the normal root state (back/forward
      // to the project root). Sync the store without raising an error.
      args.navigateTo(null);
      return;
    case "empty":
    case "overlength":
    case "not_found":
      // Req 10.5 / Req 20.4: fall back to root + inline error surface.
      args.navigateTo(null);
      args.onError(result);
      return;
  }
}

// ─── React hook ──────────────────────────────────────────────────────

/**
 * React-facing API for `useFilesTabUrlSync`. The inline-error callback lets
 * `FilesTabRoot` / `FilesTabMain` render the Req 10.5 error indicator when a
 * back/forward navigation lands on an invalid `?path=`.
 */
export interface UseFilesTabUrlSyncOptions {
  /**
   * Called when a `popstate`-triggered deep-link resolution fails. Receives
   * the failure variant (`empty` / `overlength` / `not_found`); the benign
   * `none` branch (no `?path=`) is NOT an error and is not reported. If
   * omitted, the hook falls back to a no-op.
   */
  onPopStateError?: (
    failure: Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>,
  ) => void;
  /**
   * Escape hatch for tests: inject a fake `window`. Production callers must
   * omit this so the hook binds to the real browser globals.
   */
  window?: Window;
}

export function useFilesTabUrlSync(
  projectId: string,
  options: UseFilesTabUrlSyncOptions = {},
): void {
  const location = useCurrentLocation(projectId);
  const navigateTo = useNavigateTo(projectId);
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById ?? EMPTY_NODES,
  );

  // Keep the latest callbacks in refs so the popstate subscription does not
  // re-bind every time they identity-change.
  const navigateRef = useRef<NavigateTo>(navigateTo);
  navigateRef.current = navigateTo;
  const errorRef = useRef<UseFilesTabUrlSyncOptions["onPopStateError"]>(
    options.onPopStateError,
  );
  errorRef.current = options.onPopStateError;
  const nodesByIdRef = useRef<Record<string, ProjectNode>>(nodesById);
  nodesByIdRef.current = nodesById;

  // Effect 1: mirror currentLocation → URL on every change.
  useEffect(() => {
    const win = options.window ?? getBrowserWindow();
    if (!win) return;
    const id = location?.type === "root" || !location ? null : location.id;
    const encoded = encodePath(nodesByIdRef.current, id);
    syncUrlToLocation({ win, encodedPath: encoded });
    // location is the only dependency — nodesById is intentionally read
    // through a ref so unrelated cache churn does not re-fire replaceState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, projectId, options.window]);

  // Effect 2: wire up popstate → navigateTo.
  useEffect(() => {
    const win = options.window ?? getBrowserWindow();
    if (!win) return;
    const onPopState = () => {
      void handlePopState({
        win,
        navigateTo: (nodeId) => navigateRef.current(nodeId),
        onError: (failure) => errorRef.current?.(failure),
        projectId,
        findNodeByPathAny: defaultFindNodeByPathAny,
      });
    };
    win.addEventListener("popstate", onPopState);
    return () => win.removeEventListener("popstate", onPopState);
  }, [projectId, options.window]);
}

/**
 * Default `findNodeByPathAny` adapter used by the React hook. Lazy-imports
 * the server action module so unit tests that exercise the pure helpers
 * never trigger environment-variable validation inside `@/lib/db`.
 */
async function defaultFindNodeByPathAny(
  projectId: string,
  pathParts: string[],
): Promise<{ id: string } | null> {
  const { findNodeByPathAny } = await import("@/app/actions/files/nodes");
  const result = await findNodeByPathAny(projectId, pathParts);
  if (!result) return null;
  return { id: result.id };
}

const EMPTY_NODES: Record<string, ProjectNode> = Object.freeze(
  {},
) as Record<string, ProjectNode>;

function getBrowserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

// Re-export so consumers can type the navigate callback without pulling in
// the `useNavigateTo` module directly.
export type { NavigateTo };
