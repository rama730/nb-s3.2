// Task 4.1 — `BreadcrumbBar` for the Files tab v3.
//
// Contract (see design.md § BreadcrumbBar, requirements § Req 3.1–3.6):
//   * Synchronous derivation via `ancestorChain(nodesById, location.id)` when
//     the ancestor chain is already cached. No async call on the hot path —
//     every navigation click renders a fresh breadcrumb in the same tick so
//     the four observable surfaces (tree, breadcrumb, main, URL) cannot drift
//     out of sync (Req 6.1, 6.5).
//   * Falls back to the `getBreadcrumbs` server action only when the chain is
//     missing. The deep-link arrival flow is the canonical example: the
//     resolver has landed a single file node but its ancestors have not been
//     hydrated yet. The fetched ancestors are written to the store via
//     `upsertNodes` so subsequent renders follow the synchronous path.
//   * Root segment is always rendered (even at the project root). Intermediate
//     folders render as `<button>`. File leaf renders as a bold, non-clickable
//     `<span>` per Req 3.3.
//   * Separator: `/` character between segments (Req 3.1).
//   * Truncation (Req 3.6): when `segments.length > 6`, render
//     `segments[0]` + an ellipsis `<button>` + `segments.slice(-4)`. The
//     ellipsis button opens a dropdown listing the hidden segments
//     (`segments.slice(1, -4)`).
//   * Every clickable segment has `data-breadcrumb-segment-id={segment.id}`
//     so Property 1's PBT can query the DOM without touching React internals.
//     The root button uses the literal string `"__root__"` so DOM queries can
//     distinguish it from folder segments.
//
// Requirements: Req 3.1–3.6.

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Home, MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getBreadcrumbs } from "@/app/actions/files/nodes";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { ancestorChain, type CurrentLocation } from "../navigation";
import { useNavigateTo } from "../hooks/useNavigateTo";

// ─── Public API ──────────────────────────────────────────────────────

export interface BreadcrumbBarProps {
  projectId: string;
  location: CurrentLocation | null;
  onToggleGitHubSync?: () => void;
}

/**
 * Public marker used as the `data-breadcrumb-segment-id` value for the root
 * button. We expose a literal string (not `null`) so `querySelector` +
 * attribute selectors work without special casing. Folder/file segments use
 * their raw node id, so collision with a real id is impossible (UUIDs).
 */
export const BREADCRUMB_ROOT_SEGMENT_ID = "__root__";

// ─── Segment model ───────────────────────────────────────────────────

/**
 * One rendered breadcrumb segment. The discriminant drives both rendering
 * (file is bold + non-clickable per Req 3.3) and click wiring (root clicks
 * fire `navigateTo(null)`; folder clicks fire `navigateTo(id)`). Exported so
 * unit tests (Task 4.2) can assert the derivation directly.
 */
export type BreadcrumbSegment =
  | { kind: "root"; id: null; name: string }
  | { kind: "folder"; id: string; name: string }
  | { kind: "file"; id: string; name: string };

/**
 * Derive the rendered segments from a `CurrentLocation` + the node cache.
 *
 * Rules (Req 3.1–3.3):
 *   - Always prepend a synthetic "root" segment. At the project root the
 *     breadcrumb shows just the root, keeping the bar present and focusable.
 *   - For a folder location, append every ancestor up through the folder
 *     itself; each is a clickable `folder` segment.
 *   - For a file location, append every ancestor folder, then the file as a
 *     terminal `file` segment (non-clickable).
 *
 * When `ancestorChain` returns a partial chain (the root of the chain still
 * has a non-null `parentId` that is not in `nodesById`), callers should kick
 * off the server-action fallback. The returned segments are still correct
 * for the portion of the tree that IS loaded — we render what we have and
 * replace on the next render after hydration.
 */
export function deriveBreadcrumbSegments(
  location: CurrentLocation | null,
  chain: ReadonlyArray<{ id: string; name: string; type: "folder" | "file" }>,
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [
    { kind: "root", id: null, name: "root" },
  ];
  if (location === null || location.type === "root") return segments;

  for (const node of chain) {
    if (node.type === "file") {
      segments.push({ kind: "file", id: node.id, name: node.name });
    } else {
      segments.push({ kind: "folder", id: node.id, name: node.name });
    }
  }
  return segments;
}

/**
 * Plan for how to render a list of segments given the Req 3.6 budget.
 * Exposed so the unit tests (Task 4.2) can assert the exact visible/hidden
 * partition without rendering React.
 *
 * Req 3.6 triggers only when `segments.length > 6`. Below the threshold we
 * render every segment inline.
 */
export interface BreadcrumbLayout {
  kind: "inline" | "truncated";
  /** Segments rendered inline, in display order. */
  visible: BreadcrumbSegment[];
  /** Segments hidden behind the ellipsis affordance (empty for `inline`). */
  hidden: BreadcrumbSegment[];
}

export function layoutBreadcrumb(
  segments: BreadcrumbSegment[],
): BreadcrumbLayout {
  if (segments.length <= 6) {
    return { kind: "inline", visible: segments, hidden: [] };
  }
  return {
    kind: "truncated",
    // Req 3.6: first + ellipsis + last 4.
    visible: [segments[0]!, ...segments.slice(-4)],
    hidden: segments.slice(1, -4),
  };
}

// ─── React component ─────────────────────────────────────────────────

const EMPTY_NODES = Object.freeze({}) as Record<string, never>;

/**
 * Read the cached ancestor chain for `location` and decide whether we need
 * to hit the server. The chain is considered complete when either:
 *   - it is empty (root view), or
 *   - the top-most node's `parentId` is `null` (we have walked to the root).
 *
 * An empty chain with a non-null `location.id` means the node itself is not
 * cached — we cannot even form a partial breadcrumb, so we fall back too.
 */
function needsServerFetch(
  location: CurrentLocation | null,
  chain: ReadonlyArray<{ id: string; parentId: string | null }>,
): boolean {
  if (location === null || location.type === "root") return false;
  if (chain.length === 0) return true;
  const topMost = chain[0]!;
  return topMost.parentId !== null;
}

export function BreadcrumbBar({
  projectId,
  location,
  onToggleGitHubSync,
}: BreadcrumbBarProps): React.JSX.Element {
  const navigateTo = useNavigateTo(projectId);
  // Subscribe to the node cache with a narrow selector: re-render only when
  // the project's `nodesById` changes, not on every unrelated store write.
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById ?? EMPTY_NODES,
  );
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);

  // For a file location, the breadcrumb walks the PARENT folder chain and
  // appends the file as a terminal segment. Using the file's own id in
  // `ancestorChain` already yields `[...ancestors, file]`, which is what we
  // want — the file is rendered as the terminal `file` segment per Req 3.3.
  const targetId =
    location === null || location.type === "root" ? null : location.id;

  const chain = ancestorChain(nodesById, targetId);
  const segments = deriveBreadcrumbSegments(location, chain);
  const layout = layoutBreadcrumb(segments);

  // Track the most recent fetch so stale responses (user navigated before the
  // fetch settled) never overwrite fresher hydrated state.
  const fetchSeqRef = useRef(0);
  // Dedupe: never kick off a second fetch for a target we just fetched.
  const lastFetchedTargetRef = useRef<string | null>(null);

  // ── Performance mark (Req 16.5, Task 11.1) ────────────────────────
  //
  // Emit `files-tab:breadcrumb-interactive` once, on the first render
  // after mount. A `useRef` guard keeps the mark idempotent across
  // subsequent re-renders caused by navigation or deep-link hydration.
  // The `typeof performance !== "undefined"` guard keeps this safe in
  // SSR / non-DOM test environments.
  const breadcrumbInteractiveMarkedRef = useRef(false);
  useEffect(() => {
    if (breadcrumbInteractiveMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:breadcrumb-interactive");
    breadcrumbInteractiveMarkedRef.current = true;
  }, []);

  const shouldFetch = needsServerFetch(location, chain);

  useEffect(() => {
    if (!shouldFetch) return;
    if (targetId === null) return;
    if (lastFetchedTargetRef.current === targetId) return;

    lastFetchedTargetRef.current = targetId;
    const mySeq = ++fetchSeqRef.current;
    // For a file location, ask for the file's parent (`getBreadcrumbs`
    // returns the ancestor chain of its argument). For a folder location,
    // ask for the folder itself.
    const fetchTarget =
      location !== null && location.type === "file"
        ? location.node.parentId ?? null
        : targetId;

    void (async () => {
      try {
        const rows = (await getBreadcrumbs(projectId, fetchTarget)) as Array<{
          id: string;
          name: string;
          parentId: string | null;
        }>;
        if (mySeq !== fetchSeqRef.current) return;
        if (!Array.isArray(rows) || rows.length === 0) return;
        // `getBreadcrumbs` returns lightweight rows. Hydrate the store with
        // `parentId` + `name` so `ancestorChain` on the next render yields
        // the full chain. We preserve any existing fields already cached
        // for a given id.
        const hydrated = rows.map((row) => {
          const existing = nodesById[row.id];
          if (existing) {
            return { ...existing, name: row.name, parentId: row.parentId };
          }
          // Synthetic partial record — callers of `nodesById` outside the
          // breadcrumb renderer use richer fields, but the minimum needed
          // to walk the chain is (id, name, parentId, type). Mark the
          // synthetic rows as folders because `getBreadcrumbs` only returns
          // ancestor folders (files never appear as intermediate segments).
          return {
            id: row.id,
            projectId,
            parentId: row.parentId,
            path: "",
            type: "folder" as const,
            name: row.name,
            s3Key: null,
            size: 0,
            mimeType: null,
            currentVersion: 1,
            metadata: {},
            gitHash: null,
            createdBy: null,
            deletedBy: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            deletedAt: null,
            syncStatus: "merged",
            taskId: null,
            canonicalNodeId: null,
            lastSyncedCommitSha: null,
          };
        });
        upsertNodes(projectId, hydrated);
      } catch {
        // Swallow — a transient network failure leaves the breadcrumb in
        // its best-effort partial state rather than crashing the tab.
        // `lastFetchedTargetRef` retains the target so we do not retry in
        // a tight loop; navigating to a different target resets it.
      }
    })();
  }, [projectId, shouldFetch, targetId, location, nodesById, upsertNodes]);

  return (
    <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-2 h-8 select-none w-full bg-white dark:bg-zinc-950">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-0.5 text-xs text-zinc-600 dark:text-zinc-300 overflow-x-auto h-full outline-none"
        data-testid="files-tab-breadcrumb"
      >
        {layout.kind === "inline"
          ? layout.visible.map((seg, idx) => (
              <SegmentWithSeparator
                key={seg.id ?? "__root__"}
                segment={seg}
                showSeparatorBefore={idx > 0}
                onNavigate={navigateTo}
              />
            ))
          : (
              <>
                <SegmentWithSeparator
                  segment={layout.visible[0]!}
                  showSeparatorBefore={false}
                  onNavigate={navigateTo}
                />
                <EllipsisSeparator />
                <EllipsisButton
                  hidden={layout.hidden}
                  onNavigate={navigateTo}
                />
                {layout.visible.slice(1).map((seg) => (
                  <SegmentWithSeparator
                    key={seg.id ?? "__root__"}
                    segment={seg}
                    showSeparatorBefore
                    onNavigate={navigateTo}
                  />
                ))}
              </>
            )}
      </nav>
      {onToggleGitHubSync && (
        <button
          type="button"
          onClick={onToggleGitHubSync}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors text-[11px] font-medium border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 shadow-sm outline-none"
          title="Toggle GitHub Sync & Rebase Drawer"
        >
          <svg
            className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.164 22 16.418 22 12c0-5.523-4.477-10-10-10z"
            />
          </svg>
          <span>Sync</span>
        </button>
      )}
    </div>
  );
}

// ─── Internal rendering primitives ───────────────────────────────────

function Separator(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="mx-0.5 text-zinc-400 dark:text-zinc-600 select-none"
    >
      /
    </span>
  );
}

function EllipsisSeparator(): React.JSX.Element {
  // The ellipsis affordance is preceded by a separator so the visual pattern
  // `root / … / folder` reads correctly.
  return <Separator />;
}

function SegmentWithSeparator({
  segment,
  showSeparatorBefore,
  onNavigate,
}: {
  segment: BreadcrumbSegment;
  showSeparatorBefore: boolean;
  onNavigate: (nodeId: string | null) => void;
}): React.JSX.Element {
  return (
    <>
      {showSeparatorBefore ? <Separator /> : null}
      <SegmentContent segment={segment} onNavigate={onNavigate} />
    </>
  );
}

function SegmentContent({
  segment,
  onNavigate,
}: {
  segment: BreadcrumbSegment;
  onNavigate: (nodeId: string | null) => void;
}): React.JSX.Element {
  if (segment.kind === "file") {
    // Req 3.3: file segment is bold and not clickable.
    return (
      <span
        className="font-semibold text-zinc-900 dark:text-zinc-100 px-1.5 py-0.5 truncate max-w-[200px]"
        title={segment.name}
      >
        {segment.name}
      </span>
    );
  }

  const isRoot = segment.kind === "root";
  const dataId = isRoot ? BREADCRUMB_ROOT_SEGMENT_ID : segment.id;
  return (
    <button
      type="button"
      data-breadcrumb-segment-id={dataId}
      onClick={() => onNavigate(isRoot ? null : segment.id)}
      className="flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-200 transition-colors max-w-[180px] outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      title={segment.name}
    >
      {isRoot ? (
        <Home className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      ) : null}
      <span className="truncate">{segment.name}</span>
    </button>
  );
}

function EllipsisButton({
  hidden,
  onNavigate,
}: {
  hidden: BreadcrumbSegment[];
  onNavigate: (nodeId: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Show hidden breadcrumb segments"
          // Ellipsis is itself a "clickable segment" for the PBT DOM query —
          // but it navigates to the *hidden* segments via the dropdown, so
          // it carries the literal `__ellipsis__` id rather than a node id.
          data-breadcrumb-segment-id="__ellipsis__"
          className="flex items-center px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] overflow-y-auto"
      >
        {hidden.map((seg) => {
          // Hidden list contains only intermediate folders (root is always in
          // `visible[0]` and files only appear as the terminal segment).
          // Guard against future callers stuffing root/file into hidden by
          // rendering them as disabled rows.
          const clickable = seg.kind === "folder" || seg.kind === "root";
          const targetId = seg.kind === "root" ? null : seg.id;
          return (
            <DropdownMenuItem
              key={seg.id ?? "__root__"}
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return;
                onNavigate(targetId);
                setOpen(false);
              }}
              className="gap-2"
              data-breadcrumb-segment-id={
                seg.kind === "root" ? BREADCRUMB_ROOT_SEGMENT_ID : seg.id
              }
            >
              <ChevronRight
                className="w-3 h-3 opacity-60 flex-shrink-0"
                aria-hidden="true"
              />
              <span className="truncate max-w-[240px]">{seg.name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default BreadcrumbBar;
