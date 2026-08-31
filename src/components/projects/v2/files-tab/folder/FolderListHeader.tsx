// Task 5.1 — `FolderListHeader`.
//
// Column header row for `FolderListView`. Renders the four GitHub-style
// columns (Name, Last updated, Size, By) as a sticky `<thead>`-equivalent
// row. The layout is a CSS grid rather than a native `<table>` so the
// body rows can use the same template without a wrapper `<tr>` in
// virtualized contexts.
//
// Requirements: Req 4.3 (column order / names), Req 4.9 (header always
// visible during loading / empty / error states), design.md § FolderListView.

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { FOLDER_LIST_GRID_TEMPLATE } from "./layout";

export interface FolderListHeaderProps {
  className?: string;
}

/**
 * Sticky header row for the folder list. The grid template is shared
 * with `FolderListRow` via `layout.ts` so columns stay aligned.
 */
export function FolderListHeader({
  className,
}: FolderListHeaderProps): React.JSX.Element {
  return (
    <div
      role="row"
      data-testid="files-tab-folder-list-header"
      style={{ gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE }}
      className={cn(
        "sticky top-0 z-10 grid items-center gap-x-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600",
        "dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
        className,
      )}
    >
      <div role="columnheader" data-column="name" className="min-w-0">
        Name
      </div>
      <div role="columnheader" data-column="updated" className="min-w-0">
        Last updated
      </div>
      <div
        role="columnheader"
        data-column="size"
        className="min-w-0 text-right"
      >
        Size
      </div>
      <div role="columnheader" data-column="by" className="min-w-0">
        Updated by
      </div>
      <div role="columnheader" data-column="actions"><span className="sr-only">Actions</span></div>
    </div>
  );
}

export default FolderListHeader;
