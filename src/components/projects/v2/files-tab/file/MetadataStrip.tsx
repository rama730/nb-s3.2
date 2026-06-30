// Task 6.2: Files tab metadata strip.
//
// Validates: Req 5.1, Req 5.9, Req 11.3, Req 17.1-17.4.
// See design.md § MetadataStrip and § Metadata Bug Fix (Req 17).
//
// This component is the structural fix for the metadata-stale-on-close bug
// (Req 17). Key contract:
//
//   1. Rendered ONLY when `currentLocation.type === "file"`. The parent
//      (`FileView`) is keyed by `currentLocation.id`, which forces React to
//      unmount this subtree on any id change. That unmount runs effect
//      cleanups synchronously before the new subtree mounts, so no fields
//      from the previous file can linger. (Req 17.1, 17.2, 17.4.)
//   2. Every field is derived from the `node` prop on every render — no
//      parent refs, no memoized caches, no shared module-level state.
//      (Req 17.3.)
//   3. The media-inspection side effects (`useImageDimensions`,
//      `useMediaDuration`) live INSIDE this component so their cleanup is
//      tied to this component's lifecycle. They were previously owned by
//      `AssetMetadataPanel` and outlived file switches — that panel is NOT
//      used here.
//   4. The root element carries `data-testid="files-tab-metadata-strip"`
//      and `data-node-id={node.id}` so Property 2 (`metadata_matches_selection`)
//      can verify the DOM without reaching into React internals.
//
// Missing fields render as "—" per Req 5.9. The VersionPill is rendered only
// when `currentVersion > 1` (Req 11.3).

"use client";

import * as React from "react";

import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";

import { formatBytes, formatRelativeTime } from "../folder/format";
import { TaskLinkPopover } from "../TaskLinkPopover";
import { VersionPill } from "../VersionPill";
import { FileActionsBar } from "./FileActionsBar";

// ---------------------------------------------------------------------------
// Node shape
// ---------------------------------------------------------------------------

/**
 * Optional enrichment fields the consumer may attach to the `node` prop so
 * we can render the "By" / "updater" label without reaching outside the
 * prop. `ProjectNode` itself only carries `createdBy` (user id) — the Files
 * tab enriches it upstream with the display/username strings it looks up
 * from the profiles cache. When both are absent we fall back to "—" per
 * Req 5.9.
 */
export type MetadataStripNode = ProjectNode & {
  updatedById?: string | null;
  updatedByName?: string | null;
  updatedByUsername?: string | null;
  updatedByAvatarUrl?: string | null;
  versionUpdatedAt?: Date | string | null;
};

// ---------------------------------------------------------------------------
// Side-effect hooks (owned here so cleanup runs on unmount)
// ---------------------------------------------------------------------------

type MediaKind = "image" | "video" | "audio" | "other";

function mediaKindOf(mime: string | null | undefined): MediaKind {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "other";
}

/**
 * Load intrinsic pixel dimensions of an image by URL. Null until loaded,
 * null when `url`/`kind` aren't an image, null on error. Effect cleanup
 * detaches the image handlers so a late `onload` on an unmounted component
 * cannot call `setDims`.
 */
function useImageDimensions(
  url: string | null | undefined,
  kind: MediaKind,
): { width: number; height: number } | null {
  const [dims, setDims] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    setDims(null);
    if (kind !== "image" || !url) return;
    // Guard against SSR / non-DOM environments.
    if (typeof window === "undefined" || typeof Image === "undefined") return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setDims({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (cancelled) return;
      setDims(null);
    };
    img.src = url;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      // Drop the src so the browser can cancel the in-flight request.
      img.src = "";
    };
  }, [url, kind]);

  return dims;
}

/**
 * Load media duration (seconds) by URL for `<video>` / `<audio>` sources.
 * Returns null until metadata is ready, null when kind doesn't apply.
 * The inspector element is detached on cleanup.
 */
function useMediaDuration(
  url: string | null | undefined,
  kind: MediaKind,
): number | null {
  const [duration, setDuration] = React.useState<number | null>(null);

  React.useEffect(() => {
    setDuration(null);
    if ((kind !== "video" && kind !== "audio") || !url) return;
    if (typeof document === "undefined") return;

    let cancelled = false;
    const el = document.createElement(kind === "video" ? "video" : "audio") as
      | HTMLVideoElement
      | HTMLAudioElement;
    el.preload = "metadata";

    const handleLoaded = () => {
      if (cancelled) return;
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    el.addEventListener("loadedmetadata", handleLoaded);
    el.src = url;

    return () => {
      cancelled = true;
      el.removeEventListener("loadedmetadata", handleLoaded);
      el.src = "";
      // Force the element to release its network handle.
      try {
        el.load();
      } catch {
        // Ignore: load() may throw in jsdom / exotic DOMs.
      }
    };
  }, [url, kind]);

  return duration;
}

// ---------------------------------------------------------------------------
// Field derivation
// ---------------------------------------------------------------------------

const MISSING = "—" as const;

/** ISO-8601 string or `—` when the timestamp is missing/unparseable. */
function toIso(value: string | Date | null | undefined): string {
  if (value == null) return MISSING;
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return MISSING;
  return d.toISOString();
}

/** Lowercased MIME type or `—` when the MIME type is absent / blank. */
function mimeLabel(node: MetadataStripNode): string {
  const mime = typeof node.mimeType === "string" ? node.mimeType.trim() : "";
  if (mime.length === 0) return MISSING;
  return mime.toLowerCase();
}

/** Size label: formatBytes when present, `—` when the size field is empty. */
function sizeLabel(node: MetadataStripNode): string {
  if (node.size == null) return MISSING;
  const formatted = formatBytes(node.size, "file");
  return formatted === "" ? MISSING : formatted;
}

/** Name label: the raw name, or `—` when the node name is empty. */
function nameLabel(node: MetadataStripNode): string {
  const raw = typeof node.name === "string" ? node.name : "";
  return raw.length > 0 ? raw : MISSING;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MetadataStripProps {
  /** Invariant: `node.id === currentLocation.id` (see design § Metadata Bug Fix). */
  node: MetadataStripNode;
  /** Controls whether `FileActionsBar` shows the Edit button (Req 5.3-5.4). */
  canEdit: boolean;
  /** Optional signed URL for the file blob — used by the media side effects. */
  signedUrl?: string | null;
  /** Project ID — passed to FileActionsBar for "Attach to task…" (Req 9.1). */
  projectId?: string;
  /** Number of tasks linked to this node (from store taskLinkCounts). Req 7.1. */
  taskLinkCount?: number;
  /** The current active viewing mode. */
  mode: "view" | "raw" | "edit";
  /** Callback to restore default view mode. */
  onView: () => void;
  /** Raw toggle handler (Req 5.2). */
  onRaw: () => void;
  /** Edit mode handler (Req 5.8). */
  onEdit: () => void;
  /** Download handler. */
  onDownload: () => void;
  /** Callback to toggle the LinkedTasksPanel open/closed (Req 8.1). */
  onToggleLinkedTasks?: () => void;
  /** Whether the LinkedTasksPanel is currently open (Req 8.1). */
  isLinkedTasksPanelOpen?: boolean;
  /** Callback to toggle the FileVersionHistoryPanel open/closed (Req 10.1, 10.2). */
  onToggleVersionHistory?: () => void;
  /** Whether the FileVersionHistoryPanel is currently open (Req 10.2). */
  isVersionHistoryPanelOpen?: boolean;
  /** Optional uploader display name cache map. */
  uploaderNames?: Record<string, string>;
  className?: string;
  isLinkedDoc?: boolean;
  onNavigateToDoc?: (slug: string) => void;
}

/**
 * Sticky metadata header for the Single File View. Derives every field from
 * `node` and owns the media-inspection effects so they cleanup on unmount.
 * See file-level comment for the structural bug fix for Req 17.
 */
export function MetadataStrip({
  node,
  canEdit,
  signedUrl,
  projectId,
  taskLinkCount,
  mode,
  onView,
  onRaw,
  onEdit,
  onDownload,
  onToggleLinkedTasks,
  isLinkedTasksPanelOpen,
  onToggleVersionHistory,
  isVersionHistoryPanelOpen,
  uploaderNames,
  className,
  isLinkedDoc,
  onNavigateToDoc,
}: MetadataStripProps): React.JSX.Element {
  // Dev-only invariant assertion. When this fires, the parent forgot to
  // gate the render on `currentLocation.type === "file"` or lost the
  // `key={currentLocation.id}` wrapping — both break Req 17's guarantee.
  if (process.env.NODE_ENV !== "production") {
    console.assert(Boolean(node?.id), "MetadataStrip requires node.id");
  }

  const mediaKind = mediaKindOf(node.mimeType);
  // The hooks are called unconditionally — they internally no-op when the
  // media kind does not apply. Owning them here guarantees their cleanup
  // runs when this component unmounts (the Req 17 structural fix).
  useImageDimensions(signedUrl ?? null, mediaKind);
  useMediaDuration(signedUrl ?? null, mediaKind);

  const currentVersion =
    typeof node.currentVersion === "number" && Number.isFinite(node.currentVersion)
      ? node.currentVersion
      : null;
  const showVersionPill =
    currentVersion !== null &&
    Number.isInteger(currentVersion) &&
    currentVersion > 1;

  const displayName = React.useMemo(() => {
    const directName = typeof node.updatedByName === "string" ? node.updatedByName.trim() : "";
    if (directName) return directName;
    const directUser = typeof node.updatedByUsername === "string" ? node.updatedByUsername.trim() : "";
    if (directUser) return directUser;
    if (node.createdBy && uploaderNames?.[node.createdBy]) {
      return uploaderNames[node.createdBy];
    }
    return null;
  }, [node.updatedByName, node.updatedByUsername, node.createdBy, uploaderNames]);
  const updatedAtValue = node.versionUpdatedAt ?? node.updatedAt;
  const isoTimestamp = toIso(updatedAtValue);
  const relativeTimestamp = formatRelativeTime(updatedAtValue);
  const updatedAtText =
    relativeTimestamp === MISSING
      ? MISSING
      : `Last updated ${relativeTimestamp}${displayName ? ` by ${displayName}` : ""}`;

  return (
    <div
      data-testid="files-tab-metadata-strip"
      data-node-id={node.id}
      className={cn(
        "sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur",
        "dark:border-zinc-800 dark:bg-zinc-950/95",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
        <span
          data-field="name"
          className="truncate font-medium text-zinc-900 dark:text-zinc-100"
          title={nameLabel(node)}
        >
          {nameLabel(node)}
        </span>
        <Separator />
        <span data-field="size">{sizeLabel(node)}</span>
        {showVersionPill ? (
          <>
            <Separator />
            <span data-field="version">
              <VersionPill v={currentVersion} />
            </span>
          </>
        ) : null}
        <Separator />
        {isoTimestamp === MISSING ? (
          <span data-field="updated-at">{updatedAtText}</span>
        ) : (
          <time
            data-field="updated-at"
            dateTime={isoTimestamp}
            className="tabular-nums"
            title={isoTimestamp}
          >
            {updatedAtText}
          </time>
        )}
        <Separator />
        <span data-field="mime-type">{mimeLabel(node)}</span>
        {isLinkedDoc && (
          <>
            <Separator />
            <span className="font-semibold text-zinc-800 dark:text-zinc-200" data-field="used-as-doc">
              Used as a Doc
            </span>
          </>
        )}
        {projectId && (taskLinkCount ?? 0) > 0 ? (
          <>
            <Separator />
            <TaskLinkPopover
              projectId={projectId}
              nodeId={node.id}
              count={taskLinkCount!}
            />
          </>
        ) : null}
      </div>

      <FileActionsBar
        mode={mode}
        onView={onView}
        onRaw={onRaw}
        onEdit={onEdit}
        onDownload={onDownload}
        onToggleLinkedTasks={onToggleLinkedTasks}
        isLinkedTasksPanelOpen={isLinkedTasksPanelOpen}
        onToggleVersionHistory={onToggleVersionHistory}
        isVersionHistoryPanelOpen={isVersionHistoryPanelOpen}
        projectId={projectId}
        nodeId={node.id}
        fileName={node.name}
        fileSize={node.size}
        mimeType={node.mimeType}
        isLinkedDoc={isLinkedDoc}
        onNavigateToDoc={onNavigateToDoc}
      />
    </div>
  );
}

function Separator(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="select-none text-zinc-300 dark:text-zinc-700"
    >
      •
    </span>
  );
}

export default MetadataStrip;
