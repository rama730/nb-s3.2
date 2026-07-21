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

import { toast } from "sonner";

import * as React from "react";
import {
  AlertTriangle,
  FileQuestion,
  ImageOff,
  Upload,
  VideoOff,
  VolumeOff,
} from "lucide-react";

import { useRouter, usePathname } from "next/navigation";
import { useProjectMarkdowns } from "@/hooks/hub/useProjectDocData";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import { getProjectFileSignedUrl } from "@/app/actions/files/content";
import { getProjectFileContent } from "@/app/actions/files/content";
import { listFileVersions } from "@/app/actions/files/versions";
import type { ProjectNode } from "@/lib/db/schema";
import { computeContentHash } from "@/lib/files/content-hash";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import { cn } from "@/lib/utils";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useFileVersions } from "@/hooks/useFileVersions";
import { useProjectMembers } from "@/hooks/hub/useProjectMembers";

import { fileKind, type FileKind } from "../../utils/fileKind";
import AssetPreview from "../../preview/AssetPreview";
import MarkdownPreview from "../../preview/MarkdownPreview";

import { FileVersionCompareView } from "./FileVersionCompareView";
import { FileVersionHistoryPanel } from "./FileVersionHistoryPanel";
import { LinkedTasksPanel } from "./LinkedTasksPanel";
import { MetadataStrip, type MetadataStripNode } from "./MetadataStrip";
import { TextViewer, type TextViewerMode } from "./TextViewer";
import { isAssetKind, isEmptyMedia, isMarkdownNode } from "./previewPicker";
import { RevisionControlModal } from "@/components/ui/RevisionControlModal";
import { createClient } from "@/lib/supabase/client";
import { useFileLease, type FileLeaseStatus } from "../hooks/useFileLease";
import type { BrowserFileLease, FileLeaseView } from "@/lib/files/file-lease-client";

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
type FileInspectorPanel = "linked_tasks" | "version_history" | null;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileView({
  projectId,
  node,
  canEdit,
}: FileViewProps): React.JSX.Element {
  // ── Fetch project members for uploader profiles ────────────────────
  const { data: membersData } = useProjectMembers(projectId);
  const uploaderNames = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (!membersData) return map;
    membersData.pages.forEach((page: any) => {
      page.members?.forEach((m: any) => {
        if (m?.id) {
          map[m.id] = m.fullName || m.username || m.id;
        }
      });
    });
    return map;
  }, [membersData]);

  // ── Task link count from store (Req 7.1, 7.4) ──────────────────────
  const taskLinkCount = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts?.[node.id] ?? 0,
  );

  const kind = React.useMemo<FileKind>(() => fileKind(node), [node]);
  const isMd = React.useMemo(() => isMarkdownNode(node), [node]);
  const emptyMedia = React.useMemo(() => isEmptyMedia(node, kind), [node, kind]);
  const textLike = kind === "text" || isMd;

  const [compareVersion, setCompareVersion] = React.useState<number | null>(null);
  const [restoringActive, setRestoringActive] = React.useState(false);
  const [pendingDropFile, setPendingDropFile] = React.useState<File | null>(null);
  const [isDropModalOpen, setIsDropModalOpen] = React.useState(false);

  React.useEffect(() => {
    const handleVersionChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.nodeId === node.id) {
        setRestoringActive(false);
        setCompareVersion(null);
      }
    };
    const handleVersionChangedStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.nodeId === node.id) {
        setRestoringActive(true);
      }
    };

    window.addEventListener("file:version-changed", handleVersionChanged);
    window.addEventListener("file:version-changed-start", handleVersionChangedStart);
    return () => {
      window.removeEventListener("file:version-changed", handleVersionChanged);
      window.removeEventListener("file:version-changed-start", handleVersionChangedStart);
    };
  }, [node.id]);

  const [mode, setMode] = React.useState<FileViewMode>("view");
  const [editorDirty, setEditorDirty] = React.useState(false);
  const fileLease = useFileLease(projectId, node.id);

  const onView = React.useCallback(() => {
    if (mode === "edit" && editorDirty) {
      const discard = window.confirm("Discard your unsaved changes and leave edit mode?");
      if (!discard) return;
    }
    if (mode === "edit") void fileLease.release();
    setEditorDirty(false);
    setMode("view");
  }, [editorDirty, fileLease, mode]);

  const router = useRouter();
  const pathname = usePathname();
  const projectSlug = pathname?.split("/")[2] || "";

  // Query list of documents to see if this node is linked to any of them
  const { data: markdowns = [] } = useProjectMarkdowns(projectId);
  const linkedDoc = React.useMemo(() => {
    return markdowns.find((doc: any) => doc.linkedNodeId === node.id);
  }, [markdowns, node.id]);

  const handleNavigateToDoc = React.useCallback((slug: string) => {
    router.push(`/projects/${projectSlug}?tab=docs&doc=${normalizeProjectDocSlug(slug)}`, { scroll: false });
  }, [router, projectSlug]);

  // ── LinkedTasksPanel toggle state (Req 8.1, 8.6) ───────────────────
  const [activeInspectorPanel, setActiveInspectorPanel] =
    React.useState<FileInspectorPanel>(null);
  const actionsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const isLinkedTasksPanelOpen = activeInspectorPanel === "linked_tasks";
  const isVersionHistoryPanelOpen = activeInspectorPanel === "version_history";
  const onToggleLinkedTasks = React.useCallback(() => {
    setActiveInspectorPanel((current) =>
      current === "linked_tasks" ? null : "linked_tasks",
    );
  }, []);

  // ── FileVersionHistoryPanel toggle state (Req 10.1, 10.2, 10.3) ────
  const onToggleVersionHistory = React.useCallback(() => {
    setActiveInspectorPanel((current) =>
      current === "version_history" ? null : "version_history",
    );
  }, []);

  const closeInspectorPanel = React.useCallback(() => {
    setActiveInspectorPanel(null);
    window.requestAnimationFrame(() => actionsTriggerRef.current?.focus());
  }, []);

  React.useEffect(() => {
    setActiveInspectorPanel(null);
  }, [node.id]);

  // ── Drop-zone state (Req 12.1–12.5, 24.4) ─────────────────────────
  const [isDragActive, setIsDragActive] = React.useState(false);
  const [hashMatchPromptFile, setHashMatchPromptFile] =
    React.useState<File | null>(null);
  const dragCounterRef = React.useRef(0);
  const { saveAsNewVersion } = useFileVersions(projectId, node.id);

  const handleDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Req 24.4: Role_Viewer — no drop-zone, no drops accepted
      if (!canEdit) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragCounterRef.current += 1;
      setIsDragActive(true);
    },
    [canEdit],
  );

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canEdit],
  );

  const handleDragLeave = React.useCallback(() => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Req 24.4: Role_Viewer — no drops accepted
      if (!canEdit) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragActive(false);

      const files = Array.from(event.dataTransfer.files || []);

      // Req 12.5: Multi-file drop → ignore and show toast
      if (files.length > 1) {
        toast.error("Only single-file drops accepted");
        return;
      }

      if (files.length === 0) return;

      const droppedFile = files[0];

      // Req 12.3, 12.4: Hash-check and re-upload prompt
      void (async () => {
        try {
          if (!droppedFile) return;

          // Enforce file extension type checks
          const expectedExt = extOf(node.name);
          const uploadedExt = extOf(droppedFile.name);
          if (expectedExt !== uploadedExt) {
            toast.error(`Extension mismatch: Expected .${expectedExt} but received .${uploadedExt}`);
            return;
          }

          const hashResult = await computeContentHash(droppedFile).catch(
            () => null,
          );

          // Fetch the current version's content hash for comparison
          const versions = await listFileVersions(projectId, node.id);
          const currentVersionRow = versions[0]; // sorted desc by version

          if (
            hashResult?.kind === "full" &&
            currentVersionRow?.contentHash &&
            hashResult.hashHex === currentVersionRow.contentHash
          ) {
            // Req 12.4: Hash matches — prompt "File is identical — re-upload anyway?"
            setHashMatchPromptFile(droppedFile);
            return;
          }

          // Hash differs or unknown — proceed with upload options modal
          setPendingDropFile(droppedFile);
          setIsDropModalOpen(true);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Drop failed";
          toast.error(message);
        }
      })();
    },
    [canEdit, projectId, node.id, node.name, saveAsNewVersion],
  );

  const handleDropRevisionOptionSelected = React.useCallback(
    async (choice: { option: "overwrite" | "commit"; comment?: string }) => {
      if (!pendingDropFile) return;
      const file = pendingDropFile;
      setPendingDropFile(null);

      try {
        if (choice.option === "commit") {
          const result = await saveAsNewVersion(file, { comment: choice.comment });
          if (result.success) {
            toast.success(`New revision committed successfully`);
            // Set node in store
            useFilesWorkspaceStore.getState().setNodes(projectId, [result.node]);
          } else {
            toast.error(result.error || "Failed to commit revision");
          }
        } else {
          const { saveFileRevision } = await import("@/hooks/useFileVersions");
          const result = await saveFileRevision({
            projectId,
            nodeId: node.id,
            file,
            mode: "active_revision",
            comment: choice.comment,
            baseVersion: node.currentVersion,
            supabase: createClient(),
          });

          if (result.success) {
            useFilesWorkspaceStore.getState().setNodes(projectId, [result.node]);
            toast.success("Active revision updated successfully");
          } else {
            throw new Error(result.error || "Failed to update active revision");
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast.error(message);
      }
    },
    [pendingDropFile, projectId, node.id, node.s3Key, saveAsNewVersion]
  );

  const handleHashMatchConfirm = React.useCallback(async () => {
    if (!hashMatchPromptFile) return;
    const file = hashMatchPromptFile;
    setHashMatchPromptFile(null);
    
    // Check extension
    const expectedExt = extOf(node.name);
    const uploadedExt = extOf(file.name);
    if (expectedExt !== uploadedExt) {
      toast.error(`Extension mismatch: Expected .${expectedExt} but received .${uploadedExt}`);
      return;
    }

    setPendingDropFile(file);
    setIsDropModalOpen(true);
  }, [hashMatchPromptFile, node.name]);

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
      if (mode === "edit" && editorDirty) {
        const discard = window.confirm("Discard your unsaved changes and leave edit mode?");
        if (!discard) return;
      }
      if (mode === "edit") void fileLease.release();
      setEditorDirty(false);
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
          toast.error("Could not prepare raw file");
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not prepare raw file";
        toast.error(message);
      }
    })();
  }, [textLike, signedUrl, projectId, node.id,mode, editorDirty, fileLease]);

  const onEdit = React.useCallback(() => {
    if (!canEdit) return;
    if (!textLike) {
      toast.error("This file type is not editable in place");
      return;
    }
    void fileLease.acquire()
      .then(() => setMode("edit"))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not start editing";
        toast.error(message);
      });
  }, [canEdit, textLike,fileLease]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      data-testid="files-tab-file-view"
      data-node-id={node.id}
      data-file-kind={kind}
      data-mode={mode}
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col",
        isDragActive &&
          "ring-2 ring-indigo-400 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900",
      )}
      onDragEnter={canEdit ? handleDragEnter : undefined}
      onDragOver={canEdit ? handleDragOver : undefined}
      onDragLeave={canEdit ? handleDragLeave : undefined}
      onDrop={canEdit ? handleDrop : undefined}
    >
      {/* Drop-zone overlay — Req 12.1: visible only for Role_Owner/Role_Member */}
      {isDragActive && canEdit && (
        <div
          data-testid="files-tab-file-view-drop-zone"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50/80 dark:bg-indigo-500/10"
        >
          <div className="flex flex-col items-center gap-2 text-sm font-medium text-indigo-800 dark:text-indigo-200">
            <Upload className="h-8 w-8" aria-hidden="true" />
            <span>Drop to save as new version</span>
          </div>
        </div>
      )}

      {/* Hash-match confirmation dialog — Req 12.4 */}
      <ConfirmDialog
        open={hashMatchPromptFile !== null}
        onOpenChange={(open) => {
          if (!open) setHashMatchPromptFile(null);
        }}
        title="File is identical"
        description="File is identical — re-upload anyway?"
        confirmLabel="Re-upload"
        cancelLabel="Cancel"
        onConfirm={handleHashMatchConfirm}
      />

      <MetadataStrip
        node={node as MetadataStripNode}
        projectId={projectId}
        taskLinkCount={taskLinkCount}
        mode={mode}
        onView={onView}
        onRaw={onRaw}
        onEdit={onEdit}
        onToggleLinkedTasks={onToggleLinkedTasks}
        isLinkedTasksPanelOpen={isLinkedTasksPanelOpen}
        onToggleVersionHistory={onToggleVersionHistory}
        isVersionHistoryPanelOpen={isVersionHistoryPanelOpen}
        uploaderNames={uploaderNames}
        linkedDoc={linkedDoc}
        onNavigateToDoc={handleNavigateToDoc}
        actionsTriggerRef={actionsTriggerRef}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {/* ComponentErrorBoundary satisfies Req 13.6: a render-time failure
            in the preview keeps the MetadataStrip (above) visible and shows
            an error indicator in the preview region. The boundary resets
            naturally on any node.id change because the parent remounts this
            whole subtree (see module header). */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ComponentErrorBoundary fallbackMessage="Failed to load preview">
              {compareVersion !== null ? (
                <FileVersionCompareView
                  projectId={projectId}
                  nodeId={node.id}
                  fileName={node.name}
                  baseVersion={compareVersion}
                  targetVersion={node.currentVersion ?? 1}
                  onClose={() => setCompareVersion(null)}
                />
              ) : (
                renderPreviewRegion({
                  node,
                  kind,
                  isMd,
                  emptyMedia,
                  textLike,
                  canEdit: canEdit && !restoringActive,
                  mode,
                  signedUrl,
                  signedUrlError,
                  mdContent,
                  mdError,
                  projectId,
                  lease: fileLease.lease,
                  leaseStatus: fileLease.status,
                  leaseConflict: fileLease.conflict,
                  onDirtyChange: setEditorDirty,
                  onCancel: onView,
                })
              )}
            </ComponentErrorBoundary>
          </div>

          {/* LinkedTasksPanel — collapsible right-side drawer (Req 8.1, 8.6) */}
          {isLinkedTasksPanelOpen && (
            <div className="w-80 shrink-0 border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(20rem,85vw)]">
              <LinkedTasksPanel
                projectId={projectId}
                nodeId={node.id}
                canEdit={canEdit}
                onClose={closeInspectorPanel}
                onOpenTask={(taskId) => {
                  // Open task panel with initialTab="files" (Req 8.3).
                  // The task panel opening mechanism is handled by the parent
                  // context or router — for now we dispatch a custom event
                  // that the task panel listens for.
                  window.dispatchEvent(
                    new CustomEvent("open-task-panel", {
                      detail: { taskId, initialTab: "files" },
                    }),
                  );
                }}
              />
            </div>
          )}

          {/* FileVersionHistoryPanel — collapsible right-side drawer (Req 10.1, 10.2, 10.3) */}
          {isVersionHistoryPanelOpen && (
            <div
              className="w-80 shrink-0 border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(20rem,85vw)]"
              data-testid="files-tab-version-history-drawer"
            >
              <FileVersionHistoryPanel
                projectId={projectId}
                nodeId={node.id}
                nodeName={node.name}
                canEdit={canEdit}
                currentVersion={node.currentVersion ?? 1}
                isDeleted={node.deletedAt != null}
                uploaderNames={uploaderNames}
                onCompareClick={setCompareVersion}
                onClose={closeInspectorPanel}
              />
            </div>
          )}
        </div>
      </div>
      {/* Revision control option picker modal for drops */}
      {isDropModalOpen && (
        <RevisionControlModal
          isOpen={isDropModalOpen}
          onOpenChange={setIsDropModalOpen}
          fileName={node.name}
          onSelectOption={handleDropRevisionOptionSelected}
        />
      )}
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
  lease: BrowserFileLease | null;
  leaseStatus: FileLeaseStatus;
  leaseConflict: FileLeaseView | null;
  onDirtyChange: (dirty: boolean) => void;
  onCancel?: () => void;
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
  if (p.mode === "edit" && p.textLike) {
    return (
      <TextViewer
        projectId={p.projectId}
        node={p.node}
        canEdit={p.canEdit && p.leaseStatus === "owned"}
        mode="edit"
        lease={p.lease}
        leaseStatus={p.leaseStatus}
        leaseConflict={p.leaseConflict}
        onDirtyChange={p.onDirtyChange}
        onCancel={p.onCancel}
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

  // Text default view: `TextViewer` in view mode (read-only with line numbers).
  if (p.kind === "text") {
    return (
      <TextViewer
        projectId={p.projectId}
        node={p.node}
        canEdit={p.canEdit}
        mode="view"
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
  return (
    <div
      data-testid="files-tab-file-view-binary-fallback"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
        <FileQuestion className="h-6 w-6 text-zinc-500" aria-hidden="true" />
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

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx + 1).toLowerCase();
}
