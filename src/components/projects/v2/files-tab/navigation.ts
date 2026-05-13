// Pure navigation helpers for the Files Tab GitHub redesign.
// See design.md § Supporting Hooks and § URL Contract for the contract.
//
// Task 2.1 of the Files Tab GitHub Redesign spec introduces `ancestorChain`.
// Additional hook-based helpers (`useNavigateTo`) land in Task 2.3.

import type { ProjectNode } from "@/lib/db/schema";

/**
 * The single navigation source of truth. Every observable surface (sidebar highlight,
 * breadcrumb, main area, URL) derives from this shape. See design.md § Data Flow.
 */
export type CurrentLocation =
  | { type: "root" }
  | { type: "folder"; id: string; node: ProjectNode }
  | { type: "file"; id: string; node: ProjectNode };

/**
 * Returns the root-to-node chain of ProjectNodes for `nodeId`.
 *
 * Semantics (design.md § BreadcrumbBar, Req 3.1-3.2, Req 6.5):
 * - Returns `[]` when `nodeId` is `null` (root state).
 * - Returns `[]` when `nodeId` cannot be resolved in `nodesById` (unresolved).
 * - Returns `[nodeId]` for a node whose `parentId` is `null` (root-level child).
 * - Returns `[root, ..., nodeId]` — the terminating node is always the last entry.
 *
 * The walk terminates if it encounters a missing ancestor (partial tree load),
 * yielding whatever ancestors resolved; callers treat this the same as the
 * fully-resolved chain for rendering purposes. A self-referential cycle
 * (parentId === id) or a cycle encountered along the way is broken to keep the
 * function total.
 */
export function ancestorChain(
  nodesById: Record<string, ProjectNode>,
  nodeId: string | null,
): ProjectNode[] {
  if (nodeId === null) return [];
  const start = nodesById[nodeId];
  if (!start) return [];

  const chain: ProjectNode[] = [];
  const seen = new Set<string>();
  let cursor: ProjectNode | undefined = start;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    if (cursor.parentId === null || cursor.parentId === undefined) break;
    cursor = nodesById[cursor.parentId];
  }
  return chain;
}
