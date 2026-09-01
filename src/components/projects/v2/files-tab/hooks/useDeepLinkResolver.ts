// Task 2.4 — `useDeepLinkResolver(projectId)`.
//
// Runs once on stage === "main". Reads the `?path=` query parameter, validates
// length + non-empty per Req 10.5, looks up the corresponding node via
// `findNodeByPathAny`, and either (a) dispatches `navigateTo(id)` or (b) falls
// back to root + surfaces an inline error. See design.md § useDeepLinkResolver.
//
// Split into two pieces:
//   * `resolveDeepLinkFromSearch` — a pure async coordinator that takes the
//     raw `?path=` value and resolver dependencies and returns a tagged
//     result. Tested without React, shared with `useFilesTabUrlSync`'s
//     `popstate` handler so both surfaces validate identically.
//   * `useDeepLinkResolver` — the React hook that runs once on mount (gated
//     by `stage === "main"`), threads live deps through to the pure helper,
//     exposes the error state through a callback, and guarantees the
//     resolver only fires one time per project even under React 18 strict
//     mode remount.

"use client";

import { useEffect, useRef } from "react";

import type { StartupStage } from "./useFilesTabStartupStage";
import { useNavigateTo, type NavigateTo } from "./useNavigateTo";
import { evaluateDeepLinkPath, type DeepLinkEvaluation } from "../url";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

// ─── Public result type ──────────────────────────────────────────────

/**
 * The shape returned by `resolveDeepLinkFromSearch`. Consumers pattern-match
 * on `.kind`:
 *
 *   * `ok`          — dispatched: caller should `navigateTo(nodeId)`.
 *   * `none`        — no `?path=` present: caller should stay at root.
 *   * `empty`       — `?path=` present but decoded to nothing: caller should
 *                     render the Req 10.5 inline error.
 *   * `overlength`  — decoded value > 4096 chars: same as empty, plus a
 *                     dedicated reason so callers can log / report.
 *   * `not_found`   — resolver ran but `findNodeByPathAny` returned null /
 *                     threw. Caller renders the inline error.
 */
export type ResolveDeepLinkResult =
  | { kind: "ok"; nodeId: string }
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "overlength" }
  | { kind: "not_found"; segments: string[] };

// ─── Dependency shape ────────────────────────────────────────────────

export interface ResolveDeepLinkDeps {
  projectId: string;
  /**
   * Typed adapter over the server action. Kept narrow so tests inject an
   * in-memory mock without pulling in the server module. Matches the
   * existing `findNodeByPathAny` return shape (`{ id, ... } | null`).
   */
  findNodeByPathAny: (
    projectId: string,
    pathParts: string[],
  ) => Promise<{ id: string } | null>;
}

// ─── Pure coordinator ────────────────────────────────────────────────

/**
 * Resolve a raw `?path=` value into a `ResolveDeepLinkResult`. The only I/O
 * is delegated to `deps.findNodeByPathAny`; everything else is synchronous.
 *
 * Logging contract (Req 10.5): caller is responsible for `console.log` on
 * the failure branches. We do NOT log here because `useFilesTabUrlSync`
 * shares this helper for popstate handling and over-logging would spam the
 * console on every back/forward that lands on an invalid URL.
 */
export async function resolveDeepLinkFromSearch(
  raw: string | null,
  deps: ResolveDeepLinkDeps,
): Promise<ResolveDeepLinkResult> {
  const evaluation = evaluateDeepLinkPath(raw);
  return finishEvaluation(evaluation, deps);
}

async function finishEvaluation(
  evaluation: DeepLinkEvaluation,
  deps: ResolveDeepLinkDeps,
): Promise<ResolveDeepLinkResult> {
  switch (evaluation.kind) {
    case "none":
      return { kind: "none" };
    case "error":
      return evaluation.reason === "overlength"
        ? { kind: "overlength" }
        : { kind: "empty" };
    case "resolvable": {
      try {
        const node = await deps.findNodeByPathAny(deps.projectId, evaluation.segments);
        if (!node) return { kind: "not_found", segments: evaluation.segments };
        return { kind: "ok", nodeId: node.id };
      } catch {
        // Network / access error: treat as unresolvable per the design's
        // error-handling table ("findNodeByPathAny network error → root +
        // inline error").
        return { kind: "not_found", segments: evaluation.segments };
      }
    }
  }
}

// ─── React hook ──────────────────────────────────────────────────────

export interface UseDeepLinkResolverOptions {
  /**
   * The current startup stage. The resolver MUST run once, and only once
   * `stage === "main"` per Task 2.4 / design.md § useDeepLinkResolver.
   * Callers pass the value directly from `useFilesTabStartupStage`.
   */
  stage: StartupStage;
  /**
   * Callback fired when resolution fails (empty / overlength / not_found).
   * `FilesTabRoot` uses it to raise the Req 10.5 inline error state.
   * No-op on the success branch.
   */
  onError?: (failure: Exclude<ResolveDeepLinkResult, { kind: "ok" } | { kind: "none" }>) => void;
  /**
   * Escape hatch for tests — inject a fake `window` so the hook reads from
   * a deterministic URL without jsdom.
   */
  window?: Window;
  /**
   * Escape hatch for tests — inject a fake resolver so we do not boot the
   * server action module in unit tests. Defaults to the production server
   * action in `@/app/actions/files/nodes`.
   */
  findNodeByPathAny?: ResolveDeepLinkDeps["findNodeByPathAny"];
}

export function useDeepLinkResolver(
  projectId: string,
  options: UseDeepLinkResolverOptions,
): void {
  const { stage, onError, window: winOverride, findNodeByPathAny: lookupOverride } = options;
  const navigateTo = useNavigateTo(projectId);

  // Capture latest callbacks without re-triggering the effect.
  const navigateRef = useRef<NavigateTo>(navigateTo);
  navigateRef.current = navigateTo;
  const errorRef = useRef<UseDeepLinkResolverOptions["onError"]>(onError);
  errorRef.current = onError;
  const lookupRef =
    useRef<ResolveDeepLinkDeps["findNodeByPathAny"]>(lookupOverride ?? defaultLookup);
  lookupRef.current = lookupOverride ?? defaultLookup;

  // Guard: resolver runs exactly once per (projectId). Changing projectId
  // resets the guard so tabbing between two projects both get deep-link
  // resolution. The guard is kept as a ref to survive React 18 strict-mode
  // double-invocation.
  const ranForProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (stage !== "main") return;
    if (ranForProjectRef.current === projectId) return;
    ranForProjectRef.current = projectId;

    const win = winOverride ?? getBrowserWindow();
    if (!win) return;

    const params = new URLSearchParams(
      win.location.search.startsWith("?")
        ? win.location.search.slice(1)
        : win.location.search,
    );
    const raw = params.get("path");

    void resolveDeepLinkFromSearch(raw, {
      projectId,
      findNodeByPathAny: lookupRef.current,
    }).then(async (result) => {
      switch (result.kind) {
        case "ok": {
          const currentNodes = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById || {};
          if (currentNodes[result.nodeId]) {
            navigateRef.current(result.nodeId, { preserveQuery: true });
          } else {
            try {
              const { getNodeMetadataBatch } = await import("@/app/actions/files/nodes");
              const batchResult = await getNodeMetadataBatch(projectId, [result.nodeId], { includeBreadcrumbs: true });
              if (batchResult.success && batchResult.data.nodes.length > 0) {
                const upsertNodes = useFilesWorkspaceStore.getState().upsertNodes;
                upsertNodes(projectId, batchResult.data.nodes);
              }
            } catch (e) {
              console.warn("[files-tab] deep-link metadata prefetch failed", e);
            }
            navigateRef.current(result.nodeId, { preserveQuery: true });
          }
          return;
        }
        case "none":
          // No `?path=` → stay at root, no error indicator.
          return;
        case "empty":
        case "overlength":
        case "not_found": {
          // Req 10.5: fall back to root, log the failure, surface the inline
          // error to the caller for rendering.
          console.log(
            "[files-tab] deep-link resolve failed",
            result.kind === "not_found"
              ? { reason: "not_found", segments: result.segments }
              : { reason: result.kind },
          );
          navigateRef.current(null, { preserveQuery: true });
          errorRef.current?.(result);
          return;
        }
      }
    });
  }, [projectId, stage, winOverride]);
}

async function defaultLookup(
  projectId: string,
  pathParts: string[],
): Promise<{ id: string } | null> {
  // Lazy import: keeps unit tests (which exercise the pure helpers) from
  // booting the server-actions module and its env-variable validation.
  const { findNodeByPathAny } = await import("@/app/actions/files/nodes");
  const node = await findNodeByPathAny(projectId, pathParts);
  if (!node) return null;
  return { id: node.id };
}

function getBrowserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}
