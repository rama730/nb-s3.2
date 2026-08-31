// Pure sort helpers for `FolderListView`. Exported separately so unit
// tests (Task 5.4) can import the comparator without pulling the React /
// explorer graph.
//
// Requirements: Req 4.2.
//
// The comparator implements the contract from requirements.md § 4.2:
//   "THE File_List SHALL render folder rows before file rows, and within
//    each group SHALL sort alphabetically by name using case-insensitive
//    comparison, with ties broken by the node `id` in ascending
//    lexicographic order."
//
// Notes on determinism:
//   - `localeCompare(..., undefined, { sensitivity: "base" })` provides a
//     case-insensitive name compare that also matches accent-insensitive
//     equality. We append a strict id tie-break so the sort is stable
//     even when two siblings share the exact name.
//   - The comparator is *pure*: it reads only the fields it is passed
//     and never touches the store or the network.

import type { ProjectNode } from "@/lib/db/schema";

export interface FolderListSortableNode {
  id: string;
  name: string;
  type: "file" | "folder";
  updatedAt?: Date | string | null;
  versionUpdatedAt?: Date | string | null;
  mimeType?: string | null;
}

/**
 * Strict comparator for folder-list rows. Folders sort before files;
 * within a group, case-insensitive alphabetical name order with an
 * ascending lexicographic id tie-break (Req 4.2).
 */
export function compareFolderListNodes(
  a: FolderListSortableNode,
  b: FolderListSortableNode,
  sort: "name" | "updated" | "type" = "name",
  foldersFirst = true,
): number {
  // Folders first.
  if (foldersFirst && a.type !== b.type) {
    return a.type === "folder" ? -1 : 1;
  }
  if (sort === "updated") {
    const time = (node: FolderListSortableNode) => {
      const value = new Date(node.versionUpdatedAt ?? node.updatedAt ?? 0).getTime();
      return Number.isFinite(value) ? value : 0;
    };
    const difference = time(b) - time(a);
    if (difference) return difference;
  }
  if (sort === "type") {
    const difference = (a.mimeType || "").localeCompare(b.mimeType || "");
    if (difference) return difference;
  }

  // Case-insensitive name compare with accent-insensitive sensitivity.
  const nameCmp = (a.name ?? "").localeCompare(b.name ?? "", undefined, {
    sensitivity: "base",
  });
  if (nameCmp !== 0) return nameCmp;

  // Deterministic id tie-break.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Return a new array sorted per {@link compareFolderListNodes}. Pure, so
 * unit tests can exercise it without React. Keeps the original array
 * untouched — callers can rely on referential stability of the input.
 */
export function sortFolderListNodes<T extends FolderListSortableNode>(
  nodes: readonly T[],
  sort: "name" | "updated" | "type" = "name",
): T[] {
  return [...nodes].sort((a, b) => compareFolderListNodes(a, b, sort));
}

export type { ProjectNode };
