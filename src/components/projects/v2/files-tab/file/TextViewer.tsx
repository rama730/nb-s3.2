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
//     protocol wiring (Req 15.13) or conflict-resolution dialog. FileView
//     acquires the session-scoped editing lease before mounting Edit mode.
//     The editor is loaded via `next/dynamic`
//     so CodeMirror does not ship in the Files-tab initial chunk — this is
//     required for the Req 16 performance budget (no editor code loads
//     until the user actually enters Edit mode).
//
//   • Save — an explicit `<button>Save</button>`. No autosave. The revision
//     modal chooses between an append-only new revision and replacing the
//     active revision. Both choices upload to a fresh object key and use the
//     same transactional server mutation; `upsertNodes` then propagates the
//     new metadata to every files-tab surface. Authorization, optimistic
//     base-version checks, and collaborator locks are enforced server-side.
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
import { FilesHeaderSlot } from "../FilesHeaderSlot";

import { toast } from "sonner";

import * as React from "react";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/providers/theme-provider";
import type { ProjectNode } from "@/lib/db/schema";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { RevisionControlModal } from "@/components/ui/RevisionControlModal";
import { saveFileRevision } from "@/hooks/useFileVersions";
import type { BrowserFileLease, FileLeaseView } from "@/lib/files/file-lease-client";
import type { FileLeaseStatus } from "../hooks/useFileLease";

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

export type TextViewerMode = "view" | "raw" | "edit";

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
  lease?: BrowserFileLease | null;
  leaseStatus?: FileLeaseStatus;
  leaseConflict?: FileLeaseView | null;
  onCancel?: () => void;
  onRetryLease?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
  lease = null,
  leaseStatus = "idle",
  leaseConflict = null,
  onCancel,
  onRetryLease,
}: TextViewerProps): React.JSX.Element {
  const { resolvedTheme } = useTheme();
  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);

  type LoadStatus = "loading" | "ready" | "error";
  const [status, setStatus] = React.useState<LoadStatus>("loading");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // `savedContent` is the canonical server-side text; `content` is the live
  // buffer. They diverge only in Edit mode after a user keystroke, and
  // re-converge after a successful Save.
  const [savedContent, setSavedContent] = React.useState<string>("");
  const [content, setContent] = React.useState<string>("");
  const [baseVersion, setBaseVersion] = React.useState(node.currentVersion ?? 1);
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const editSnapshot = React.useRef<{ nodeId: string; version: number; updatedAt: ProjectNode["updatedAt"] } | null>(null);
  if (mode !== "edit") editSnapshot.current = null;
  else if (editSnapshot.current?.nodeId !== node.id) editSnapshot.current = { nodeId: node.id, version: node.currentVersion ?? 1, updatedAt: node.updatedAt };
  // Freeze the base while editing: realtime revisions must not replace the draft.
  const loadVersion = editSnapshot.current?.version ?? node.currentVersion ?? 1;
  const loadUpdatedAt = editSnapshot.current?.updatedAt ?? node.updatedAt;
  const [baseHash, setBaseHash] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  // ── Dark theme extension (lazy-loaded) ─────────────────────────────
  // Loaded asynchronously to keep the initial chunk lean. The resolved
  // value is cached in state so the editor re-renders with the correct
  // theme within 500ms of a runtime theme change (Req 19.4).
  const [oneDarkTheme, setOneDarkTheme] = React.useState<
    import("@codemirror/state").Extension | null
  >(null);

  React.useEffect(() => {
    if ((mode !== "edit" && mode !== "view") || resolvedTheme !== "dark") {
      setOneDarkTheme(null);
      return;
    }
    let cancelled = false;
    void import("@codemirror/theme-one-dark").then((mod) => mod.oneDark).then((ext) => {
      if (!cancelled) setOneDarkTheme(ext);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, resolvedTheme]);

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
    setBaseHash(null);
    setBaseVersion(loadVersion);

    void (async () => {
      try {
        const [{ getProjectFileContent }, { listFileVersions }] = await Promise.all([
          import("@/app/actions/files/content"),
          import("@/app/actions/files/versions"),
        ]);
        const [text, versions] = await Promise.all([
          getProjectFileContent(projectId, node.id),
          mode === "edit" ? listFileVersions(projectId, node.id) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setSavedContent(text);
        setContent(text);
        setBaseHash(
          versions.find((version) => version.version === loadVersion)?.contentHash ?? null,
        );
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
  }, [projectId, node.id, mode, loadVersion, loadUpdatedAt, loadAttempt]);

  // ── Dirty state ────────────────────────────────────────────────────
  // Only meaningful in Edit mode; Raw always renders `savedContent`, so
  // it can never be dirty. Report changes to the parent for the metadata
  // strip's indicator.
  const isDirty = mode === "edit" && content !== savedContent;
  React.useEffect(() => {
    const discard = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectId === projectId && detail.nodeId === node.id) setContent(savedContent);
    };
    window.addEventListener("project:discard-file-edits", discard);
    return () => window.removeEventListener("project:discard-file-edits", discard);
  }, [projectId, node.id, savedContent]);
  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  React.useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

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
  const handleSaveClick = React.useCallback(() => {
    if (!canEdit) return;
    if (!lease) {
      toast.error("Editing lease was lost. Your text is preserved; reacquire the file before saving.");
      return;
    }
    if (isSaving) return;
    if (!isDirty) return;
    if (!node.s3Key) {
      toast.error("Cannot save: file has no storage key.");
      return;
    }
    setIsModalOpen(true);
  }, [canEdit, isSaving, isDirty, node.s3Key, lease]);

  const handleRevisionOptionSelected = React.useCallback(
    async (choice: { option: "overwrite" | "commit"; comment?: string }) => {
      if (!canEdit || isSaving) return;
      setIsSaving(true);
      setSaveError(null);

      try {
        const supabase = createSupabaseBrowserClient();
        const file = new File([content], node.name, {
          type: node.mimeType || "text/plain",
        });
        const result = await saveFileRevision({
          projectId,
          nodeId: node.id,
          file,
          mode: choice.option === "commit" ? "new_revision" : "active_revision",
          comment: choice.comment || (choice.option === "commit" ? "Updated via Editor" : null),
          baseVersion,
          baseHash,
          lease,
          supabase,
        });

        if (result.success) {
          setSavedContent(content);
          setBaseHash(result.version.contentHash ?? null);
          setBaseVersion(result.version.version);
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
          upsertNodes(projectId, [result.node]);
          onSaved?.();
          toast.success(choice.option === "commit"
              ? "New revision committed successfully"
              : "Active revision updated successfully");
        } else {
          setSaveError(result.error || "Failed to save revision");
          toast.error(result.error || "Failed to save revision");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setSaveError(message);
        toast.error(`Failed to save: ${message}`);
      } finally {
        setIsSaving(false);
      }
    },
    [baseHash, baseVersion, canEdit, content, isSaving, lease, node.id, node.name, node.mimeType, node.s3Key, onSaved, projectId,upsertNodes]
  );

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
        <Button variant="outline" onClick={() => setLoadAttempt(value => value + 1)}>Retry preview</Button>
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

  if (mode === "view") {
    return (
      <div
        data-testid="files-tab-text-viewer-view"
        className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-zinc-950"
      >
        <div className="min-h-0 flex-1">
          <CodeMirrorEditor
            value={content}
            editable={false}
            readOnly={true}
            theme={
              resolvedTheme === "dark"
                ? oneDarkTheme ?? "dark"
                : "light"
            }
            height="100%"
            width="100%"
            className="h-full font-mono text-xs"
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
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

  // Edit mode: thinned CodeMirror. No lint (Req 15.4), no cursor-presence
  // (Req 15.13), and no merge dialog. The parent already owns the exclusive
  // editing lease; losing it makes this editor read-only without dropping the
  // dirty buffer. The explicit Save button is the only persistence channel.
  return (
    <div
      data-testid="files-tab-text-viewer-edit"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <FilesHeaderSlot slot="status"><div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {isDirty ? (
            <span
              data-testid="files-tab-text-viewer-dirty"
              className="max-w-16 truncate rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 sm:max-w-none dark:bg-amber-900/30 dark:text-amber-300"
              title="Unsaved changes"
            >
              Unsaved changes
            </span>
          ) : (
            <span data-testid="files-tab-text-viewer-clean">Saved</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isSaving}
              data-testid="files-tab-text-viewer-cancel"
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleSaveClick}
            disabled={!canEdit || !isDirty || isSaving}
            data-testid="files-tab-text-viewer-save"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div></FilesHeaderSlot>
      {saveError && <div role="alert" className="border-b border-red-200 p-3 text-xs text-red-700 dark:border-red-900 dark:text-red-300">
        <p>{saveError} Your draft is still here.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => {
          const url = URL.createObjectURL(new Blob([content], { type: node.mimeType || "text/plain" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = node.name;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Download draft</Button>
      </div>}
      {leaseStatus === "lost" || leaseStatus === "conflict" ? (
        <div
          role="alert"
          data-testid="files-tab-text-viewer-lease-lost"
          className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {leaseConflict
            ? `${leaseConflict.lockedByName || "Another collaborator"} is editing this file${leaseConflict.clientKind === "vscode" ? " in VS Code" : ""}.`
            : "The editing lease was lost. Your unsaved buffer is preserved, but saving is blocked until editing access is restored."}
          {onRetryLease && <Button variant="outline" size="sm" className="ml-2" onClick={onRetryLease}>Retry editing access</Button>}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={content}
          onChange={(next) => setContent(next)}
          editable={canEdit}
          readOnly={!canEdit}
          theme={
            resolvedTheme === "dark"
              ? oneDarkTheme ?? "dark"
              : "light"
          }
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

      {isModalOpen && (
        <RevisionControlModal
          isOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          fileName={node.name}
          onSelectOption={handleRevisionOptionSelected}
        />
      )}
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
