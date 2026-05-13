// Task 6.1 — `FileView`, the Single_File_View surface.
//
// Validates: Req 1.5, Req 1.6, Req 5.5–5.7, Req 13.1–13.6, Req 17.1–17.4.
// See design.md § FileView and § Metadata Bug Fix.
//
// Contract:
//
//   • Mounted via `<FileView key={location.id} ...>` from `FilesTabMain`
//     (Task 8.2) so the ENTIRE subtree — including `MetadataStrip`, the
//     preview region, and the `TextViewer` buffer — fully remounts when
//     the active file changes. This is the structural fix for Req 17
//     (the metadata-stale-on-close bug) — no shared caches, no stale
//     effect residue.
//
//   • Exactly one file rendered at a time (Req 1.6). The preview region
//     is one of:
//       - `AssetPreview`  for image / video / audio / pdf / doc
//         (MIME- or extension-resolved via `fileKind`; Req 13.1–13.4)
//       - `MarkdownPreview` for `.md` / `.markdown` (Req 5.5, Req 13.5)
//       - `TextViewer` for other text-like files (Req 5.2, Req 5.8)
//       - `BinaryFallback` for anything we cannot preview (Req 5.7 —
//         no editor tabs, no split panes, no console).
//
//   • 0-byte image / video / audio → empty-media placeholder in place of
//     the preview (Req 5.6). The MIME / kind check is retained so a
//     mis-typed MIME does not cause us to incorrectly hide content for
//     valid 0-byte PDFs or binaries, which are not covered by Req 5.6.
//
//   • Preview load error → inline error indicator in the preview region;
//     `MetadataStrip` and the Raw action stay visible (Req 13.6). Two
//     sources of preview-load failures are handled explicitly:
//       1. Signed-URL mint failure (needed by `AssetPreview`) — caught
//          in-place, renders `<PreviewError>`.
//       2. Markdown content fetch failure — caught in-place, renders
//          `<PreviewError>`.
//     Any other rendering error bubbling out of the preview subtree is
//     caught by `ComponentErrorBoundary` which renders the same error
//     indicator without unmounting the `MetadataStrip`.
//
//   • Mode state (Raw / Edit) is local to this component and resets when
//     the parent remounts on a file switch. See the "Mode state machine"
//     comment below.

"use client";

import * as React from "react";
import {
  AlertTriangle,
  FileQuestion,
  ImageOff,
  VideoOff,
  VolumeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import { useToast } from "@/components/ui-custom/Toast";
import { getProjectFileSignedUrl } from "@/app/actions/files/content";
import { getProjectFileContent } from "@/app/actions/files";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { fileKind, type FileKind } from "../../utils/fileKind";
import { formatBytes } from "../folder/format";
import AssetPreview from "../../preview/AssetPreview";
import MarkdownPreview from "../../preview/MarkdownPreview";

import { MetadataStrip, type MetadataStripNode } from "./MetadataStrip";
import { TextViewer, type TextViewerMode } from "./TextViewer";
import { isAssetKind, isEmptyMedia, isMarkdownNode } from "./previewPicker";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileViewProps {
  projectId: string;
  /** Invariant: `node.type === "file"`. Enforced by `FilesTabMain`. */
  node: ProjectNode;
  /** Derived in `FilesTabRoot` from the role context (Role_Owner | Role_Member). */
  canEdit: boolean;
}

// ---------------------------------------------------------------------------
// Mode state machine
// ---------------------------------------------------------------------------
//
// Three modes drive the preview region for text-like files:
//   • "view"  — default. Rendered markdown for `.md`; `TextViewer` in raw
//               mode for other text. Asset kinds always show `AssetPreview`
//               regardless of mode (Raw / Edit are non-applicable for
//               binaries; see `onRaw` / `onEdit` below).
//   • "raw"   — Req 5.2. Plain text, no toolbars / highlighting /
//               line-numbers. For markdown, this shows the source. For a
//               binary file, the Raw button opens the signed URL in a new
//               tab instead of toggling into this mode.
//   • "edit"  — Req 5.8. `TextViewer` in editable mode with an explicit
//               Save button. Hidden entirely for `Role_Viewer` (Req 5.4);
//               the Edit control itself is not rendered in that case
//               (see `FileActionsBar`), so this mode is unreachable.
//
// Because `FileView` is keyed by `currentLocation.id` at the parent, the
// mode state is always fresh per file — "Edit was sticky across file
// switches" was one of the Req 17 failure vectors; this design eliminates
// it structurally.

type FileViewMode = "view" | "raw" | "edit";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileView({
  projectId,
  node,
  canEdit,
}: FileViewProps): React.JSX.Element {
  const { showToast } = useToast();

  const kind = React.useMemo<FileKind>(() => fileKind(node), [node]);
  const isMd = React.useMemo(() => isMarkdownNode(node), [node]);
  const emptyMedia = React.useMemo(() => isEmptyMedia(node, kind), [node, kind]);
  const textLike = kind === "text" || isMd;

  const [mode, setMode] = React.useState<FileViewMode>("view");

  // Signed URL for asset / markdown / binary previews and for the
  // Download + Raw-on-binary actions. Fetched lazily and cached at the
  // component level (a fresh mount on id change refetches — desired).
  const [signedUrl, setSignedUrl] = React.useState<string | null>(null);
  const [signedUrlError, setSignedUrlError] = React.useState<string | null>(null);

  // Markdown content for `MarkdownPreview`. Only fetched when the rendered
  // markdown view is active.
  const [mdContent, setMdContent] = React.useState<string | null>(null);
  const [mdError, setMdError] = React.useState<string | null>(null);

  // ── Signed URL fetch ────────────────────────────────────────────────
  // Text-only files never need a signed URL (content is streamed through
  // `getProjectFileContent`). Asset / binary / markdown preview flows all
  // need one so the `<img>` / `<video>` / `<object>` elements can load
  // the blob directly.
  const needsSignedUrl = !node.s3Key ? false : !(kind === "text" && !isMd);

  React.useEffect(() => {
    if (!needsSignedUrl) {
      setSignedUrl(null);
      setSignedUrlError(null);
      return;
    }
    let cancelled = false;
    setSignedUrl(null);
    setSignedUrlError(null);

    (async () => {
      try {
        const res = await getProjectFileSignedUrl(projectId, node.id, 300);
        if (cancelled) return;
        if (!res?.url) {
          setSignedUrlError("Signed URL was empty");
          return;
        }
        setSignedUrl(res.url);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to prepare preview";
        setSignedUrlError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, node.id, needsSignedUrl]);

  // ── Markdown content fetch ──────────────────────────────────────────
  // Only needed for the rendered view (`mode === "view"` + markdown
  // kind). Raw / Edit modes hand off to `TextViewer`, which has its own
  // fetch-on-demand.
  const fetchMd = isMd && mode === "view";

  React.useEffect(() => {
    if (!fetchMd) return;

    if (node.size === 0) {
      setMdContent("");
      setMdError(null);
      return;
    }

    let cancelled = false;
    setMdContent(null);
    setMdError(null);

    (async () => {
      try {
        const text = await getProjectFileContent(projectId, node.id);
        if (cancelled) return;
        setMdContent(text);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load markdown";
        setMdError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, node.id, node.size, fetchMd]);

  // ── Action handlers ─────────────────────────────────────────────────

  const onRaw = React.useCallback(() => {
    if (textLike) {
      setMode("raw");
      return;
    }
    // Non-text/markdown: "Raw" opens the signed URL in a new tab, matching
    // GitHub's behaviour. Mint a fresh URL if we don't have one cached.
    (async () => {
      try {
        let url = signedUrl;
        if (!url) {
          const res = await getProjectFileSignedUrl(projectId, node.id, 300);
          url = res?.url ?? null;
        }
        if (!url) {
          showToast("Could not prepare raw file", "error");
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not prepare raw file";
        showToast(message, "error");
      }
    })();
  }, [textLike, signedUrl, projectId, node.id, showToast]);

  const onEdit = React.useCallback(() => {
    if (!canEdit) return;
    if (!textLike) {
      showToast("This file type is not editable in place", "error");
      return;
    }
    setMode("edit");
  }, [canEdit, textLike, showToast]);

  const onDownload = React.useCallback(() => {
    (async () => {
      try {
        let url = signedUrl;
        if (!url) {
          const res = await getProjectFileSignedUrl(projectId, node.id, 300);
          url = res?.url ?? null;
        }
        if (!url) {
          showToast("Could not prepare download", "error");
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not prepare download";
        showToast(message, "error");
      }
    })();
  }, [signedUrl, projectId, node.id, showToast]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      data-testid="files-tab-file-view"
      data-node-id={node.id}
      data-file-kind={kind}
      data-mode={mode}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <MetadataStrip
        node={node as MetadataStripNode}
        canEdit={canEdit}
        signedUrl={signedUrl}
        onRaw={onRaw}
        onEdit={onEdit}
        onDownload={onDownload}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {/* ComponentErrorBoundary satisfies Req 13.6: a render-time failure
            in the preview keeps the MetadataStrip (above) visible and shows
            an error indicator in the preview region. The boundary resets
            naturally on any node.id change because the parent remounts this
            whole subtree (see module header). */}
        <ComponentErrorBoundary fallbackMessage="Failed to load preview">
          {renderPreviewRegion({
            node,
            kind,
            isMd,
            emptyMedia,
            textLike,
            canEdit,
            mode,
            signedUrl,
            signedUrlError,
            mdContent,
            mdError,
            projectId,
          })}
        </ComponentErrorBoundary>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview region — pure dispatch
// ---------------------------------------------------------------------------
//
// Extracted out of `FileView` so the preview-picker logic is free of hooks
// and easy to read linearly. The parent owns all state; this function is
// effectively a `switch` over (kind, mode, empty-media, error) producing
// exactly one child element.

interface PreviewRegionProps {
  node: ProjectNode;
  kind: FileKind;
  isMd: boolean;
  emptyMedia: boolean;
  textLike: boolean;
  canEdit: boolean;
  mode: FileViewMode;
  signedUrl: string | null;
  signedUrlError: string | null;
  mdContent: string | null;
  mdError: string | null;
  projectId: string;
}

function renderPreviewRegion(p: PreviewRegionProps): React.JSX.Element {
  // Req 5.6 — 0-byte image / video / audio: empty-media placeholder
  // regardless of mode. For audio we still honour Raw / Edit so markdown
  // wrappers around empty files behave sanely, but image/video/audio are
  // never text-like and never enter Raw / Edit via the button handlers.
  if (p.emptyMedia) {
    return <EmptyMediaPlaceholder kind={p.kind} />;
  }

  // Edit mode (text / markdown only). `onEdit` refuses to set this mode
  // for non-text kinds, so we only need to check text-likeness.
  if (p.mode === "edit" && p.canEdit && p.textLike) {
    return (
      <TextViewer
        projectId={p.projectId}
        node={p.node}
        canEdit={p.canEdit}
        mode="edit"
      />
    );
  }

  // Raw mode on text / markdown. Mode is sticky until the parent remounts
  // (i.e. the user navigates to a different file).
  if (p.mode === "raw" && p.textLike) {
    return (
      <TextViewer
        projectId={p.projectId}
        node={p.node}
        canEdit={p.canEdit}
        mode={"raw" satisfies TextViewerMode}
      />
    );
  }

  // Markdown default view: rendered preview (Req 5.5, Req 13.5).
  if (p.isMd) {
    if (p.mdError) {
      return <PreviewError message={p.mdError} />;
    }
    if (p.mdContent === null) {
      return <PreviewLoading />;
    }
    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <MarkdownPreview content={p.mdContent} />
      </div>
    );
  }

  // Text default view: `TextViewer` in raw mode. Edit is reached only via
  // the action bar button.
  if (p.kind === "text") {
    return (
      <TextViewer
        projectId={p.projectId}
        node={p.node}
        canEdit={p.canEdit}
        mode="raw"
      />
    );
  }

  // Asset kinds: image / video / audio / pdf / doc (Req 13.1–13.4).
  // `AssetPreview` needs the signed URL; failure to mint one is a preview
  // load error per Req 13.6.
  if (isAssetKind(p.kind)) {
    if (p.signedUrlError) {
      return <PreviewError message={p.signedUrlError} />;
    }
    if (!p.signedUrl) {
      return <PreviewLoading />;
    }
    return (
      <div className="flex-1 min-h-0">
        <AssetPreview node={p.node} signedUrl={p.signedUrl} />
      </div>
    );
  }

  // Everything else is an unpreviewable binary.
  return <BinaryFallback node={p.node} signedUrl={p.signedUrl} />;
}

// ---------------------------------------------------------------------------
// Inline presentational components
// ---------------------------------------------------------------------------

function PreviewLoading(): React.JSX.Element {
  return (
    <div
      data-testid="files-tab-file-view-loading"
      className="flex flex-1 items-center justify-center p-8 text-xs text-zinc-500 dark:text-zinc-400"
    >
      Loading preview…
    </div>
  );
}

interface PreviewErrorProps {
  message: string;
}

function PreviewError({ message }: PreviewErrorProps): React.JSX.Element {
  // Req 13.6: error indicator in the preview region; the caller keeps
  // `MetadataStrip` (with Raw action) visible above this.
  return (
    <div
      data-testid="files-tab-file-view-preview-error"
      role="alert"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center",
        "text-xs text-zinc-600 dark:text-zinc-300",
      )}
    >
      <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        Failed to load preview
      </p>
      {message ? (
        <p className="max-w-md break-words text-zinc-500 dark:text-zinc-400">
          {message}
        </p>
      ) : null}
    </div>
  );
}

interface EmptyMediaPlaceholderProps {
  kind: FileKind;
}

function EmptyMediaPlaceholder({
  kind,
}: EmptyMediaPlaceholderProps): React.JSX.Element {
  // Req 5.6 — 0-byte image / video / audio. Render an inline placeholder
  // instead of the AssetPreview so the browser does not attempt to
  // decode zero bytes.
  const { Icon, label } = React.useMemo(() => {
    if (kind === "image") {
      return { Icon: ImageOff, label: "image" };
    }
    if (kind === "video") {
      return { Icon: VideoOff, label: "video" };
    }
    return { Icon: VolumeOff, label: "audio" };
  }, [kind]);

  return (
    <div
      data-testid="files-tab-file-view-empty-media"
      data-media-kind={kind}
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-xs text-zinc-600 dark:text-zinc-300"
    >
      <Icon className="h-8 w-8 text-zinc-400" aria-hidden="true" />
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        This {label} is empty
      </p>
      <p className="text-zinc-500 dark:text-zinc-400">
        The file has a size of 0 bytes, so there is nothing to preview.
      </p>
    </div>
  );
}

interface BinaryFallbackProps {
  node: ProjectNode;
  signedUrl: string | null;
}

/**
 * Default preview for files that do not match any supported kind
 * (image / video / audio / pdf / doc / text / markdown). Shows the file
 * name + MIME + size and, when a signed URL is available, an "Open" link
 * that opens the file in a new tab.
 *
 * Inline rather than a separate file per the task description: "Add
 * `BinaryFallback` as an inline or separate component for unsupported
 * binary files."
 */
function BinaryFallback({
  node,
  signedUrl,
}: BinaryFallbackProps): React.JSX.Element {
  const mime = (node.mimeType || "unknown").toLowerCase();
  const size = formatBytes(node.size, "file") || "—";
  return (
    <div
      data-testid="files-tab-file-view-binary-fallback"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
        <FileQuestion className="h-6 w-6 text-zinc-500" aria-hidden="true" />
      </div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {node.name}
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {mime} · {size}
      </div>
      <div className="max-w-md text-xs text-zinc-500 dark:text-zinc-400">
        This file type doesn&apos;t have an inline preview. Open it in a new
        tab to view.
      </div>
      {signedUrl ? (
        <Button asChild size="sm" variant="outline">
          <a href={signedUrl} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </a>
        </Button>
      ) : null}
    </div>
  );
}

export default FileView;
