// Task 3.3 — `SingleAttachmentPicker` wrapper.
//
// Wraps V3AttachmentPicker for in-panel single-file attachment.
// Calls `linkNodeToTask` immediately upon selection (no confirm step).
// Used in `TaskDetailTabs/FilesTab` for in-panel attachment.
//
// Requirements: 6.6

"use client";

import React, { useCallback, useState } from "react";

import type { ProjectNode } from "@/lib/db/schema";
import { linkNodeToTask } from "@/app/actions/files";
import { useToast } from "@/components/ui-custom/Toast";

import { V3AttachmentPicker } from "./V3AttachmentPicker";

// ─── Public API ──────────────────────────────────────────────────────

export interface SingleAttachmentPickerProps {
  projectId: string;
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
  existingAttachments: ProjectNode[];
}

// ─── Component ───────────────────────────────────────────────────────

export function SingleAttachmentPicker({
  projectId,
  taskId,
  isOpen,
  onClose,
  existingAttachments,
}: SingleAttachmentPickerProps): React.JSX.Element | null {
  const { showToast } = useToast();
  const [isLinking, setIsLinking] = useState(false);

  // Track already-attached node IDs so we can filter them from selection
  const existingIds = new Set(existingAttachments.map((n) => n.id));

  const handleSelectionChange = useCallback(
    async (nodes: ProjectNode[]) => {
      // Find the newly selected node (not already attached)
      const newNode = nodes.find((n) => !existingIds.has(n.id));
      if (!newNode || isLinking) return;

      // Immediately link the node to the task
      setIsLinking(true);
      try {
        await linkNodeToTask(taskId, newNode.id);
        showToast(`Attached "${newNode.name}" to task.`, "success");
        onClose();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to attach file";
        showToast(message, "error");
        // Keep picker open on failure (Req 9.5 pattern)
      } finally {
        setIsLinking(false);
      }
    },
    [existingIds, isLinking, taskId, showToast, onClose],
  );

  if (!isOpen) return null;

  return (
    <V3AttachmentPicker
      projectId={projectId}
      isOpen={isOpen}
      onClose={onClose}
      initialSelection={existingAttachments}
      onSelectionChange={handleSelectionChange}
    />
  );
}

export default SingleAttachmentPicker;
