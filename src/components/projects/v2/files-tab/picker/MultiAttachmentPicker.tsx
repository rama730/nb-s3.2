// Task 3.2 — `MultiAttachmentPicker` wrapper.
//
// Wraps V3AttachmentPicker with a confirm/cancel flow for multi-file
// selection. Used in `CreateTaskModal` for attaching files during task
// creation.
//
// Requirements: 6.5

"use client";

import React, { useCallback, useEffect, useState } from "react";

import type { ProjectNode } from "@/lib/db/schema";

import { V3AttachmentPicker } from "./V3AttachmentPicker";

// ─── Public API ──────────────────────────────────────────────────────

export interface MultiAttachmentPickerProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  initialAttachments: ProjectNode[];
  onConfirm: (nodes: ProjectNode[]) => void;
}

// ─── Component ───────────────────────────────────────────────────────

/**
 * Multi-file attachment picker with explicit confirm/cancel semantics.
 *
 * Renders the V3AttachmentPicker and tracks selection changes internally.
 * Selection is only committed when the user clicks "Confirm". Closing
 * via the X button or backdrop click discards uncommitted changes.
 */
export function MultiAttachmentPicker({
  projectId,
  projectName,
  isOpen,
  onClose,
  initialAttachments,
  onConfirm,
}: MultiAttachmentPickerProps): React.JSX.Element | null {
  // Track the current selection internally so we can commit only on confirm
  const [pendingSelection, setPendingSelection] =
    useState<ProjectNode[]>(initialAttachments);

  // Sync when picker opens with new initialAttachments
  useEffect(() => {
    if (isOpen) {
      setPendingSelection(initialAttachments);
    }
  }, [isOpen, initialAttachments]);

  const handleSelectionChange = useCallback((nodes: ProjectNode[]) => {
    setPendingSelection(nodes);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(pendingSelection);
    onClose();
  }, [onConfirm, onClose, pendingSelection]);

  // Close without committing (cancel)
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Keyboard: Enter to confirm when picker is open
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleConfirm]);

  if (!isOpen) return null;

  return (
    <>
      {/* Render V3AttachmentPicker — it manages its own backdrop at z-50 */}
      <V3AttachmentPicker
        projectId={projectId}
        projectName={projectName}
        isOpen={true}
        onClose={handleCancel}
        initialSelection={initialAttachments}
        onSelectionChange={handleSelectionChange}
      />

      {/* Confirm/Cancel footer — rendered above the picker's z-index */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] flex items-center justify-end gap-2 px-6 py-3 pointer-events-none"
        data-testid="multi-attachment-picker"
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          <button
            type="button"
            onClick={handleCancel}
            data-testid="multi-attachment-picker-cancel"
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="multi-attachment-picker-confirm"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Confirm{pendingSelection.length > 0 ? ` (${pendingSelection.length})` : ""}
          </button>
        </div>
      </div>
    </>
  );
}

export default MultiAttachmentPicker;
