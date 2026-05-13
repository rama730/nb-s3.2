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
}

/**
 * Strict comparator for folder-list rows. Folders sort before files;
 * within a group, case-insensitive alphabetical name order with an
 * ascending lexicographic id tie-break (Req 4.2).
 */
export function compareFolderListNodes(
  a: FolderListSortableNode,
  b: FolderListSortableNode,
): number {
  // Folders first.
  if (a.type !== b.type) {
    return a.type === "folder" ? -1 : 1;
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
): T[] {
  return [...nodes].sort(compareFolderListNodes);
}

export type { ProjectNode };
