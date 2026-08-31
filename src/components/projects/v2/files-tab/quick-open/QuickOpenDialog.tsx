// Quick-open: parent owns ⌘P/open/query, this dialog owns debounced file search.

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useShallow } from "zustand/react/shallow";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import {
  getTaskWorkingFilesDisplayName,
  isProjectSystemRoot,
} from "@/lib/files/task-working-files";

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
    const displayName = getTaskWorkingFilesDisplayName(node);
    if (seen.has(nodeId)) return displayName; // defensive: cycle guard
    seen.add(nodeId);
    if (isProjectSystemRoot(node)) {
      cache.set(nodeId, "");
      return "";
    }
    if (!node.parentId) {
      cache.set(nodeId, displayName);
      return displayName;
    }
    const parentPath = resolve(node.parentId, seen);
    const path = parentPath ? `${parentPath}/${displayName}` : displayName;
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
  const nodePathById = useMemo(() => buildNodePathMap(nodesById), [nodesById]);
  const rawQuery = debouncedQuery.trim();
  const showRecents = rawQuery.length === 0;
  const search = useInfiniteQuery({
    queryKey: ["files-quick-open", projectId, rawQuery],
    enabled: open && rawQuery.length >= 2,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { getProjectNodes } = await import("@/app/actions/files/nodes");
      return getProjectNodes(projectId, null, rawQuery, MAX_RESULTS, pageParam);
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const recentIds = recents.slice(0, MAX_RECENTS);
  const recentFiles = useQuery({
    queryKey: ["files-quick-open-recent", projectId, recentIds.join(",")],
    enabled: open && showRecents,
    queryFn: async () => {
      if (!recentIds.length) return [];
      const { getNodeMetadataBatch } = await import("@/app/actions/files/nodes");
      const result = await getNodeMetadataBatch(projectId, recentIds);
      if (!result.success) throw new Error(result.message);
      const order = new Map(recentIds.map((id, index) => [id, index]));
      return result.data.nodes.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    },
    staleTime: 30_000,
  });
  const source = showRecents ? recentFiles : search;
  const isSearchingServer = (showRecents || rawQuery.length >= 2) && source.isPending || query.trim() !== rawQuery;
  const searchError = source.error?.message;
  // Search results come only from the authorized server page, never stale cache hits.
  const results = useMemo(() => {
    const nodes = showRecents ? recentFiles.data ?? [] : rawQuery.length < 2 ? [] : search.data?.pages.flatMap(page => page.nodes) ?? [];
    return nodes.filter(node => node.type === "file" && !node.deletedAt);
  }, [showRecents, recentFiles.data, search.data, rawQuery]);
  useEffect(() => {
    useFilesWorkspaceStore.getState().upsertNodes(projectId, results);
  }, [results, projectId]);

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
      const fresh = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById[candidate.id];
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

  const emptyRecents = showRecents && results.length === 0 && !isSearchingServer && !searchError;
  const noMatches = !showRecents && results.length === 0 && !isSearchingServer && !searchError;
  const activeResult = results[safeActiveIndex];

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} data-testid="files-tab-quick-open" className="block max-w-2xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Quick open</DialogTitle>
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
              activeResult
                ? `files-tab-quick-open-item-${activeResult.id}`
                : undefined
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
        {searchError ? (
          <div role="alert" className="border-b border-zinc-200 px-4 py-2 text-sm text-red-600 dark:border-zinc-800 dark:text-red-400">
            {searchError} <button type="button" onClick={() => void source.refetch()} className="underline">Retry</button>
          </div>
        ) : isSearchingServer ? (
          <div role="status" aria-live="polite" className="border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
            Searching the full project…
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
              {rawQuery.length < 2 ? "Type at least two characters to search." : "No matching files"}
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
                  <div className="text-xs text-zinc-500 truncate">
                    {fullPath}
                  </div>
                </button>
              );
            })
          )}
        </div>
        {!showRecents && search.hasNextPage && <button type="button" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()} className="m-3 min-h-10 rounded border px-3 text-sm">{search.isFetchingNextPage ? "Loading…" : "Load more results"}</button>}
      </div>
      </DialogContent>
    </Dialog>
  );
}

// Stable empty values so the shallow selector does not treat `{}`/`[]`
// literals as fresh on every render.
const EMPTY_NODES_BY_ID: Record<string, ProjectNode> = Object.freeze(
  {},
) as Record<string, ProjectNode>;
const EMPTY_RECENTS: readonly string[] = Object.freeze([]) as readonly string[];

export default QuickOpenDialog;
