// Pure helpers extracted from `FilesTabSidebar` so unit tests can import
// them without pulling the heavyweight explorer / server-action graph
// through their transitive imports.
//
// Requirements: Req 2.2, Req 2.6, Req 15.14.
// See design.md § FilesTabSidebar for the authoritative contract.

import type { ProjectNode } from "@/lib/db/schema";

/**
 * Fixed sidebar width in pixels when visible. Derived here (not inside
 * `FilesTabSidebar.tsx`) so the unit test can assert the constant without
 * touching React or the preserved-explorer modules.
 *
 * Req 2.6 / Req 15.14.
 */
export const FILES_TAB_SIDEBAR_WIDTH_PX = 280;

/** Header height used by the sidebar header row (design.md § FilesTabSidebar). */
export const FILES_TAB_SIDEBAR_HEADER_HEIGHT_PX = 32;

/** Inline-search debounce window (design.md § FilesTabSidebar header row). */
export const FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS = 200;

/**
 * Compute the set of node ids that remain visible when `query` is applied
 * to the project's nodes. A node is visible when:
 *   (a) its name contains `query` as a case-insensitive substring, OR
 *   (b) it is an ancestor (parent chain) of such a matching node.
 *
 * Empty / whitespace-only `query` returns `null`, signalling "no filter
 * active" so the caller can skip the substring match entirely and render
 * the full tree honouring only the current expand/collapse state (Req 2.3).
 *
 * Exported so the unit test exercises the pure filter without mounting
 * React.
 */
export function computeVisibleIdsForSearch(
  nodesById: Record<string, ProjectNode>,
  rawQuery: string,
): Set<string> | null {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return null;

  const visible = new Set<string>();
  for (const id in nodesById) {
    const node = nodesById[id];
    if (!node) continue;
    if (!node.name.toLowerCase().includes(query)) continue;

    // The matching node itself is visible.
    visible.add(node.id);

    // Walk parents so every ancestor of a matching node is retained.
    // Bound the walk to guard against malformed cycles in nodesById.
    let cursor: string | null = node.parentId ?? null;
    let guard = 0;
    while (cursor && guard < 256 && !visible.has(cursor)) {
      visible.add(cursor);
      const parent: ProjectNode | undefined = nodesById[cursor];
      cursor = parent?.parentId ?? null;
      guard += 1;
    }
  }
  return visible;
}
