// Task 6.4: Files tab text viewer (Raw + thinned CodeMirror Edit).
//
// Validates: Req 5.2, Req 5.8, Req 15.4, Req 15.13.
// See design.md § FileView and § Open Question 6.
//
// Surface contract:
//
//   • Raw mode — Req 5.2: plain text `<pre>`, no toolbars, no syntax
//     highlighting, no line numbers. Renders the last-saved snapshot
//     (`savedContent`), never the dirty buffer, so switching Raw ↔ Edit
//     cannot surface unsaved noise as "the raw bytes".
//
//   • Edit mode — Req 5.8 + Open Question 6: thinned CodeMirror setup.
//     Explicitly no lint plugin (Req 15.4), no cursor-presence / cursor
//     protocol wiring (Req 15.13), no conflict-resolution dialog, and no
//     client-side lock acquisition. The editor is loaded via `next/dynamic`
//     so CodeMirror does not ship in the Files-tab initial chunk — this is
//     required for the Req 16 performance budget (no editor code loads
//     until the user actually enters Edit mode).
//
//   • Save — an explicit `<button>Save</button>`. No autosave, no
//     conflict-merge UI. On click we upload the current buffer straight to
//     object storage and call `updateProjectFileStats` to refresh the DB
//     row; `upsertNodes` then propagates the new `size` / `updatedAt` to
//     every other files-tab surface (breadcrumb, folder list, metadata
//     strip). The server action still enforces write access
//     (`assertProjectWriteAccess`) and lock-conflict checks
//     (`assertNodeNotLockedByAnotherUser`) server-side, so skipping
//     *client* lock acquisition does not weaken authorization.
//
//   • Dirty state — reported through the optional `onDirtyChange` callback
//     so the parent (`FileView`) can thread it into `MetadataStrip` per
//     Open Question 2 ("explicit Save + dirty indicator"). We do not keep
//     a per-tab dirty-buffer store (design § Store Changes / DROPPED
//     `fileStates`); the buffer lives as local state and is lost on
//     unmount, which is intentional — `FileView` is keyed by
//     `currentLocation.id` so switching files remounts this component and
//     discards the stale buffer. That is the same structural guarantee
//     that fixes the Req 17 metadata-stale bug.

"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import {
  getProjectFileContent,
  updateProjectFileStats,
} from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

// Dynamic import keeps `@uiw/react-codemirror` (and its `@codemirror/*`
// transitive tree) out of the Files-tab initial chunk. The import only
// fires when the user actually switches into Edit mode, preserving the
// Req 16.1–16.3 performance budget. `ssr: false` is required because the
// editor touches `window` and `document` during construction.
const CodeMirrorEditor = dynamic(
  () => import("@uiw/react-codemirror").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <EditorLoading />,
  },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextViewerMode = "raw" | "edit";

export interface TextViewerProps {
  projectId: string;
  node: ProjectNode;
  canEdit: boolean;
  /**
   * Active mode. Controlled by the parent `FileView` (wired to the
   * `Raw` / `Edit` buttons in `FileActionsBar`).
   */
  mode: TextViewerMode;
  /**
   * Fired once a Save round-trip completes successfully. The parent can
   * use this to clear a dirty badge, show a toast, or record a recent.
   */
  onSaved?: () => void;
  /**
   * Fired whenever the dirty state of the Edit buffer changes. The parent
   * (via `FileView`) threads this into `MetadataStrip` for the dirty
   * indicator required by Open Question 2.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UTF8_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TextViewer({
  projectId,
  node,
  canEdit,
  mode,
  onSaved,
  onDirtyChange,
}: TextViewerProps): React.JSX.Element {
  const { showToast } = useToast();
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);

  type LoadStatus = "loading" | "ready" | "error";
  const [status, setStatus] = React.useState<LoadStatus>("loading");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // `savedContent` is the canonical server-side text; `content` is the live
  // buffer. They diverge only in Edit mode after a user keystroke, and
  // re-converge after a successful Save.
  const [savedContent, setSavedContent] = React.useState<string>("");
  const [content, setContent] = React.useState<string>("");
  const [isSaving, setIsSaving] = React.useState(false);

  // ── Fetch-on-demand ────────────────────────────────────────────────
  // Per task: no per-tab dirty-buffer store. We fetch the content every
  // time this component mounts or the backing node id changes. Because
  // the parent `FileView` is keyed by `currentLocation.id`, a file switch
  // produces a fresh mount and a fresh fetch — no shared cache to go stale.
  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setLoadError(null);
    setContent("");
    setSavedContent("");

    void (async () => {
      try {
        const text = await getProjectFileContent(projectId, node.id);
        if (cancelled) return;
        setSavedContent(text);
        setContent(text);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load file content";
        setLoadError(message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, node.id]);

  // ── Dirty state ────────────────────────────────────────────────────
  // Only meaningful in Edit mode; Raw always renders `savedContent`, so
  // it can never be dirty. Report changes to the parent for the metadata
  // strip's indicator.
  const isDirty = mode === "edit" && content !== savedContent;
  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // When leaving Edit mode, discard the in-memory buffer back to the last
  // saved snapshot. Users must save to persist — this matches the explicit
  // Save semantics from Open Question 2 and prevents Raw from displaying
  // unsaved edits.
  React.useEffect(() => {
    if (mode === "raw") {
      setContent(savedContent);
    }
  }, [mode, savedContent]);

  // ── Save ───────────────────────────────────────────────────────────
  const handleSave = React.useCallback(async () => {
    if (!canEdit) return;
    if (isSaving) return;
    if (!isDirty) return;
    if (!node.s3Key) {
      showToast("Cannot save: file has no storage key.", "error");
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const blob = new Blob([content], {
        type: node.mimeType || "text/plain",
      });
      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .update(node.s3Key, blob, { upsert: true });
      if (uploadError) throw uploadError;

      const size = UTF8_ENCODER.encode(content).length;
      const updatedNode = (await updateProjectFileStats(
        projectId,
        node.id,
        size,
      )) as ProjectNode | null;
      if (updatedNode) {
        upsertNodes(projectId, [updatedNode]);
      }

      setSavedContent(content);
      onSaved?.();
      showToast("File saved", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      showToast(`Failed to save: ${message}`, "error");
    } finally {
      setIsSaving(false);
    }
  }, [
    canEdit,
    content,
    isDirty,
    isSaving,
    node.id,
    node.mimeType,
    node.s3Key,
    onSaved,
    projectId,
    showToast,
    upsertNodes,
  ]);

  // ── Render ─────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div
        data-testid="files-tab-text-viewer-loading"
        className="flex h-full min-h-0 w-full items-center justify-center text-xs text-zinc-500 dark:text-zinc-400"
      >
        Loading…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        data-testid="files-tab-text-viewer-error"
        className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-zinc-600 dark:text-zinc-300"
      >
        <p className="font-medium">Failed to load file content</p>
        {loadError ? (
          <p className="max-w-md break-words text-zinc-500 dark:text-zinc-400">
            {loadError}
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === "raw") {
    // Req 5.2: plain text, no toolbars, no syntax highlighting, no line
    // numbers. A bare `<pre>` is the entire surface — nothing else.
    return (
      <pre
        data-testid="files-tab-text-viewer-raw"
        className={cn(
          "h-full min-h-0 w-full overflow-auto whitespace-pre-wrap break-words",
          "bg-white p-4 font-mono text-xs leading-relaxed text-zinc-900",
          "dark:bg-zinc-950 dark:text-zinc-100",
        )}
      >
        {savedContent}
      </pre>
    );
  }

  // Edit mode: thinned CodeMirror. No lint (Req 15.4), no cursor-presence
  // (Req 15.13), no conflict resolution, no lock acquisition (Q6). The
  // explicit Save button is the only persistence channel.
  return (
    <div
      data-testid="files-tab-text-viewer-edit"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {isDirty ? (
            <span
              data-testid="files-tab-text-viewer-dirty"
              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            >
              Unsaved changes
            </span>
          ) : (
            <span data-testid="files-tab-text-viewer-clean">Saved</span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canEdit || !isDirty || isSaving}
          data-testid="files-tab-text-viewer-save"
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={content}
          onChange={(next) => setContent(next)}
          editable={canEdit}
          readOnly={!canEdit}
          height="100%"
          width="100%"
          className="h-full"
          // Thinned basicSetup. No language extensions, no search keymap,
          // no lint keymap, no completion — the Edit surface is a plain
          // text editor, not an IDE.
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            bracketMatching: true,
            closeBrackets: false,
            autocompletion: false,
            highlightSelectionMatches: false,
            searchKeymap: false,
            lintKeymap: false,
            foldKeymap: false,
            completionKeymap: false,
            closeBracketsKeymap: false,
          }}
        />
      </div>
    </div>
  );
}

function EditorLoading(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
      Loading editor…
    </div>
  );
}

export default TextViewer;
