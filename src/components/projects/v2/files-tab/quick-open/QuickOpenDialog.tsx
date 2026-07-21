// Quick-open: parent owns ⌘P/open/query, this dialog owns debounced file search.

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { useNavigateTo } from "../hooks/useNavigateTo";

// ─── Constants (Req 9.2–9.3) ─────────────────────────────────────────

const MAX_QUERY_LEN = 256;
const MAX_RECENTS = 20;
const MAX_RESULTS = 50;
const DEBOUNCE_MS = 200;

// ─── Pure helpers (unit-testable) ────────────────────────────────────

/**
 * Build a `Map<nodeId, "a/b/c">` from a flat `nodesById` cache.
 *
 * Matches the legacy `nodePathById` memo in
 * `WorkspaceTabManager.ts` so fuzzy-path matching (Req 9.3) behaves
 * identically after extraction. Uses memoization on a local cache so each
 * ancestor is resolved at most once per call.
 *
 * Nodes whose ancestry cannot be fully resolved (orphaned parent pointer
 * during a concurrent cache eviction) fall back to the node's own name —
 * the same resilience strategy used by the legacy implementation.
 */
export function buildNodePathMap(
  nodesById: Record<string, ProjectNode>,
): Map<string, string> {
  const cache = new Map<string, string>();
  const resolve = (nodeId: string, seen: Set<string>): string => {
    const cached = cache.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodesById[nodeId];
    if (!node) return "";
    if (seen.has(nodeId)) return node.name; // defensive: cycle guard
    seen.add(nodeId);
    if (!node.parentId) {
      cache.set(nodeId, node.name);
      return node.name;
    }
    const parentPath = resolve(node.parentId, seen);
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    cache.set(nodeId, path);
    return path;
  };
  for (const nodeId of Object.keys(nodesById)) {
    resolve(nodeId, new Set<string>());
  }
  return cache;
}

/**
 * Fuzzy-rank file nodes by name + path against a lower-cased query.
 *
 * Scoring matches the legacy Quick Open ranking:
 *   - exact name match: +500
 *   - name startsWith : +300
 *   - name includes   : +180
 *   - path includes   : +120
 * Nodes that score zero are excluded; ties break on the node name
 * ascending. Truncates to `limit` (default 50 per Req 9.3).
 *
 * Call with an empty query if you want zero results — recents are
 * handled by the hook path, not here.
 */
export function rankFuzzyResults(
  fileNodes: ProjectNode[],
  nodePathById: Map<string, string>,
  rawQueryLower: string,
  limit: number = MAX_RESULTS,
): ProjectNode[] {
  if (!rawQueryLower) return [];
  const scored: Array<{ node: ProjectNode; score: number }> = [];
  for (const node of fileNodes) {
    const name = node.name.toLowerCase();
    const path = (nodePathById.get(node.id) || node.name).toLowerCase();
    let score = 0;
    if (name === rawQueryLower) score += 500;
    if (name.startsWith(rawQueryLower)) score += 300;
    if (name.includes(rawQueryLower)) score += 180;
    if (path.includes(rawQueryLower)) score += 120;
    if (score === 0) continue;
    scored.push({ node, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name),
  );
  return scored.slice(0, limit).map((item) => item.node);
}

// ─── Component ───────────────────────────────────────────────────────

export interface QuickOpenDialogProps {
  projectId: string;
  /** Open state owned by `FilesTabRoot` (Task 8.1). */
  open: boolean;
  /** Controlled search input value. */
  query: string;
  /** Invoked on input edits and on close-paths that discard input. */
  onQueryChange: (q: string) => void;
  /** Invoked when the dialog wants to close (Escape, selection, backdrop). */
  onOpenChange: (open: boolean) => void;
}

export function QuickOpenDialog({
  projectId,
  open,
  query,
  onQueryChange,
  onOpenChange,
}: QuickOpenDialogProps): React.JSX.Element | null {
  const navigateTo = useNavigateTo(projectId);

  // Single shallow subscription to the slice bits we render from.
  const { nodesById, recents } = useFilesWorkspaceStore(
    useShallow((s) => {
      const ws = s.byProjectId[projectId];
      return {
        nodesById: ws?.nodesById ?? EMPTY_NODES_BY_ID,
        recents: ws?.recents ?? EMPTY_RECENTS,
      };
    }),
  );

  // ── Debounced query (Req 9.3) ──────────────────────────────────────
  // When the query clears we flush synchronously so the empty→Recents
  // transition is instant (there is no fuzzy search to debounce).
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    if (query.length === 0) {
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // ── Derived collections ────────────────────────────────────────────
  const fileNodes = useMemo(
    () =>
      Object.values(nodesById).filter(
        (n): n is ProjectNode => !!n && n.type === "file",
      ),
    [nodesById],
  );
  const nodePathById = useMemo(() => buildNodePathMap(nodesById), [nodesById]);

  const rawQuery = debouncedQuery.trim();
  const rawQueryLower = rawQuery.toLowerCase();
  const showRecents = rawQueryLower.length === 0;

  // ── Results ────────────────────────────────────────────────────────
  const results: ProjectNode[] = useMemo(() => {
    if (showRecents) {
      // Req 9.2: up to 20 Recents, most-recent first, files only.
      // Drop ids that no longer resolve (cache-evicted / deleted node).
      const seen = new Set<string>();
      const out: ProjectNode[] = [];
      for (const id of recents) {
        if (seen.has(id)) continue;
        seen.add(id);
        const node = nodesById[id];
        if (node && node.type === "file") out.push(node);
        if (out.length >= MAX_RECENTS) break;
      }
      return out;
    }
    return rankFuzzyResults(fileNodes, nodePathById, rawQueryLower, MAX_RESULTS);
  }, [
    showRecents,
    rawQueryLower,
    recents,
    nodesById,
    fileNodes,
    nodePathById,
  ]);

  // ── Active (focused) result index + scroll into view (Req 9.4) ────
  const [activeIndex, setActiveIndex] = useState(0);
  // Reset focus to the top whenever the results set changes (new query or
  // dialog freshly opened).
  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, open]);

  // Clamp activeIndex if the results list shrinks underneath us.
  const safeActiveIndex =
    results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[safeActiveIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [safeActiveIndex, open, results.length]);

  // ── Inline "selected node gone" error (Req 9.6) ────────────────────
  const [missingNodeError, setMissingNodeError] = useState<string | null>(null);
  // Any query edit or open/close transition clears the stale error.
  useEffect(() => {
    setMissingNodeError(null);
  }, [debouncedQuery, open]);

  // ── Close path (Req 9.7) ───────────────────────────────────────────
  const close = useCallback(() => {
    onQueryChange(""); // discards input per Req 9.7
    setMissingNodeError(null);
    onOpenChange(false);
  }, [onOpenChange, onQueryChange]);

  // ── Selection (Req 9.5 / 9.6) ──────────────────────────────────────
  const selectByIndex = useCallback(
    (index: number) => {
      const candidate = results[index];
      if (!candidate) return;
      // Re-read the cache at commit time: a concurrent cache eviction or
      // server-side delete may have removed the node since the memoized
      // `results` array was last computed. Req 9.6: show inline error,
      // leave `currentLocationId` alone.
      const fresh = useFilesWorkspaceStore
        .getState()
        .byProjectId[projectId]?.nodesById[candidate.id];
      if (!fresh || fresh.type !== "file") {
        setMissingNodeError(
          `"${candidate.name}" is no longer available. It may have been deleted or moved.`,
        );
        return;
      }
      navigateTo(candidate.id);
      // Clear input and close — navigateTo already fired, so close() only
      // affects dialog-local state.
      onQueryChange("");
      setMissingNodeError(null);
      onOpenChange(false);
    },
    [navigateTo, onOpenChange, onQueryChange, projectId, results],
  );

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => (i + 1) % results.length); // wrap per Req 9.4
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectByIndex(safeActiveIndex);
      }
    },
    [close, results.length, safeActiveIndex, selectByIndex],
  );

  if (!open) return null;

  const emptyRecents = showRecents && results.length === 0;
  const noMatches = !showRecents && results.length === 0;
  const activeResult = results[safeActiveIndex];

  return (
    <div
      // Fixed full-viewport backdrop — matches the mini-IDE host's overlay
      // rendering. `onMouseDown` on the backdrop fires `close()` so clicks
      // landing on the scrim (not the dialog surface) dismiss the dialog.
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label="Quick open"
      data-testid="files-tab-quick-open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden"
        onMouseDown={(e) => {
          // Prevent backdrop click from firing when interacting with the
          // dialog surface itself (e.g., clicking between rows).
          e.stopPropagation();
        }}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <input
            data-testid="files-tab-quick-open-input"
            autoFocus
            type="text"
            className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
            placeholder="Quick open files..."
            value={query}
            // Req 9.3: input is bounded to 1..256 chars; enforce the upper
            // bound at the UI level so typed/pasted input cannot exceed
            // the contract.
            maxLength={MAX_QUERY_LEN}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="files-tab-quick-open-listbox"
            aria-activedescendant={
              activeResult ? `files-tab-quick-open-item-${activeResult.id}` : undefined
            }
          />
        </div>
        {missingNodeError ? (
          <div
            role="alert"
            data-testid="files-tab-quick-open-error"
            className="px-4 py-2 text-sm text-red-600 dark:text-red-400 border-b border-zinc-200 dark:border-zinc-800"
          >
            {missingNodeError}
          </div>
        ) : null}
        <div
          id="files-tab-quick-open-listbox"
          className="max-h-[60vh] overflow-auto divide-y divide-zinc-200 dark:divide-zinc-800"
          role="listbox"
        >
          {emptyRecents ? (
            <div
              data-testid="files-tab-quick-open-empty-recents"
              className="px-4 py-3 text-sm text-zinc-500"
            >
              No recent files
            </div>
          ) : noMatches ? (
            <div
              data-testid="files-tab-quick-open-no-results"
              className="px-4 py-3 text-sm text-zinc-500"
            >
              No matching files
            </div>
          ) : (
            results.map((node, idx) => {
              const isActive = idx === safeActiveIndex;
              const fullPath = nodePathById.get(node.id) || node.name;
              return (
                <button
                  key={node.id}
                  id={`files-tab-quick-open-item-${node.id}`}
                  role="option"
                  aria-selected={isActive}
                  type="button"
                  data-quick-open-item-id={node.id}
                  data-quick-open-active={isActive ? "true" : "false"}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  className={
                    "w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 " +
                    (isActive ? "bg-zinc-50 dark:bg-zinc-900" : "")
                  }
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => selectByIndex(idx)}
                >
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {node.name}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{fullPath}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// Stable empty values so the shallow selector does not treat `{}`/`[]`
// literals as fresh on every render.
const EMPTY_NODES_BY_ID: Record<string, ProjectNode> = Object.freeze({}) as Record<
  string,
  ProjectNode
>;
const EMPTY_RECENTS: readonly string[] = Object.freeze([]) as readonly string[];

export default QuickOpenDialog;
