// Task 6.3: Files tab file actions bar (Raw / Edit / Download).
// Edit is hidden entirely when role === "Role_Viewer" (Req 5.3-5.4, 19.3).
// Role is read from FilesTabRoleContext. When the context is absent, we
// default to read-only (canEdit=false) so the mutation affordance stays
// hidden — consistent with Req 19.3 ("must not be visible, focusable, or
// activatable" for Role_Viewer). See design.md § FileActionsBar.
"use client";

import * as React from "react";
import { Download, FileCode2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { FilesTabRoleContext } from "../FilesTabRoleContext";

export interface FileActionsBarProps {
  onRaw: () => void;
  onEdit: () => void;
  onDownload: () => void;
  className?: string;
}

export function FileActionsBar({
  onRaw,
  onEdit,
  onDownload,
  className,
}: FileActionsBarProps): React.JSX.Element {
  const roleCtx = React.useContext(FilesTabRoleContext);
  // Default to read-only when no provider is mounted so the Edit control
  // stays hidden rather than defaulting to a mutation-capable state.
  const canEdit = roleCtx?.canEdit ?? false;

  return (
    <div
      data-testid="files-tab-file-actions-bar"
      className={cn("flex items-center gap-1", className)}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRaw}
        data-testid="files-tab-file-actions-raw"
      >
        <FileCode2 aria-hidden="true" />
        Raw
      </Button>
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEdit}
          data-testid="files-tab-file-actions-edit"
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDownload}
        data-testid="files-tab-file-actions-download"
      >
        <Download aria-hidden="true" />
        Download
      </Button>
    </div>
  );
}

export default FileActionsBar;
