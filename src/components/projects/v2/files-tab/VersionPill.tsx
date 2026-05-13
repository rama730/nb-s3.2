// Task 6.2: Shared version pill for the Files Tab.
// Renders a small "v{N}" badge used next to file names in the folder list
// (Req 11.1) and inside the MetadataStrip (Req 11.3).
//
// Rendering contract (Req 11):
//   - The pill is rendered only when `currentVersion` is an integer > 1.
//     Callers are expected to gate the render; this component treats any
//     input ≤ 1, non-integer, or non-finite as a no-op (returns null) so
//     accidental renders do not leak a "v1" or "vNaN" badge into the UI.
//
// No state, no side effects. Styling mirrors the existing version chip in
// TaskFileRow for visual consistency across the product.
"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface VersionPillProps {
  /** `projectNodes.currentVersion` — expected integer > 1. */
  v: number | null | undefined;
  className?: string;
}

/**
 * Renders a "vN" badge when `v` is an integer greater than 1. Otherwise
 * returns `null` so callers can unconditionally render `<VersionPill v={...} />`
 * without needing their own guard (though the design docs also expect a
 * caller-side guard for clarity — see Req 11.1, 11.3).
 */
export function VersionPill({ v, className }: VersionPillProps): React.JSX.Element | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  if (v <= 1) return null;

  return (
    <span
      data-testid="files-tab-version-pill"
      data-version={v}
      className={cn(
        "inline-flex h-[18px] items-center rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide",
        "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
        "dark:bg-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-500/30",
        className,
      )}
      title={`Version ${v}`}
    >
      v{v}
    </span>
  );
}

export default VersionPill;
