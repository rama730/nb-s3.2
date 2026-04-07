"use client";

import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes } from "@/app/actions/files";

// --- FolderPicker (standalone sub-component) ---

export function FolderPicker({
  projectId,
  selectedFolderId,
  onSelectFolder,
}: {
  projectId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}) {
  const [rootFolders, setRootFolders] = useState<ProjectNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, ProjectNode[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const run = async () => {
      const res = await getProjectNodes(projectId, null);
      const nodes = Array.isArray(res) ? res : res.nodes;
      setRootFolders(nodes.filter((n) => n.type === "folder"));
    };
    void run();
  }, [projectId]);

  const toggle = async (node: ProjectNode) => {
    const isOpen = !!expanded[node.id];
    if (isOpen) {
      setExpanded((p) => ({ ...p, [node.id]: false }));
      return;
    }
    setExpanded((p) => ({ ...p, [node.id]: true }));
    if (children[node.id]) return;
    setLoading((p) => ({ ...p, [node.id]: true }));
    try {
      const res = await getProjectNodes(projectId, node.id);
      const nodes = Array.isArray(res) ? res : res.nodes;
      setChildren((p) => ({ ...p, [node.id]: nodes.filter((n) => n.type === "folder") }));
    } finally {
      setLoading((p) => ({ ...p, [node.id]: false }));
    }
  };

  const renderNode = (node: ProjectNode, level: number) => {
    const isOpen = !!expanded[node.id];
    const isSelected = selectedFolderId === node.id;
    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer",
            isSelected && "bg-blue-50 dark:bg-blue-900/20"
          )}
          style={{ paddingLeft: `${level * 14 + 8}px` }}
          onClick={() => onSelectFolder(node.id)}
        >
          <button
            className="w-5 h-5 inline-flex items-center justify-center text-zinc-500"
            onClick={(e) => {
              e.stopPropagation();
              void toggle(node);
            }}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {isOpen ? (
            <FolderOpen className="w-4 h-4 text-blue-500" />
          ) : (
            <Folder className="w-4 h-4 text-blue-500" />
          )}
          <span className="text-sm truncate">{node.name}</span>
        </div>
        {isOpen ? (
          loading[node.id] ? (
            <div
              className="px-2 py-1.5 text-xs text-zinc-500"
              style={{ paddingLeft: `${(level + 1) * 14 + 8}px` }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : (
            (children[node.id] || []).map((c) => renderNode(c, level + 1))
          )
        ) : null}
      </div>
    );
  };

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 max-h-[280px] overflow-auto">
      <button
        className={cn(
          "w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900",
          selectedFolderId === null && "bg-blue-50 dark:bg-blue-900/20"
        )}
        onClick={() => onSelectFolder(null)}
      >
        Root
      </button>
      <div className="py-1">{rootFolders.map((n) => renderNode(n, 0))}</div>
    </div>
  );
}

// --- Dialog components ---

export function CreateDialog({
  createDialog,
  setCreateDialog,
  confirmCreate,
  canEdit,
  nestedDialogClassName,
  nestedDialogOverlayClassName,
}: {
  createDialog:
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string };
  setCreateDialog: React.Dispatch<
    React.SetStateAction<
      | { open: false }
      | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
    >
  >;
  confirmCreate: () => Promise<void>;
  canEdit: boolean;
  nestedDialogClassName?: string;
  nestedDialogOverlayClassName?: string;
}) {
  return (
    <Dialog
      open={createDialog.open}
      onOpenChange={(open) => setCreateDialog(open ? createDialog : { open: false })}
    >
      {createDialog.open ? (
        <DialogContent
          className={nestedDialogClassName}
          overlayClassName={nestedDialogOverlayClassName}
        >
          <DialogHeader>
            <DialogTitle>
              {createDialog.kind === "folder" ? "Create folder" : "Create file"}
            </DialogTitle>
            <DialogDescription>
              {createDialog.kind === "folder"
                ? "Create a new folder in the current location."
                : "Create a new file in the current location."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder={
                createDialog.kind === "folder" ? "Folder name" : "File name (e.g. index.tsx)"
              }
              value={createDialog.name}
              onChange={(e) =>
                setCreateDialog((d) => (d.open ? { ...d, name: e.target.value } : d))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmCreate();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog({ open: false })}>
              Cancel
            </Button>
            <Button onClick={() => void confirmCreate()} disabled={!canEdit}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function RenameDialog({
  renameState,
  setRenameState,
  confirmRename,
  canEdit,
  nestedDialogClassName,
  nestedDialogOverlayClassName,
}: {
  renameState: { nodeId: string | null; value: string; original: string };
  setRenameState: React.Dispatch<
    React.SetStateAction<{ nodeId: string | null; value: string; original: string }>
  >;
  confirmRename: () => Promise<void>;
  canEdit: boolean;
  nestedDialogClassName?: string;
  nestedDialogOverlayClassName?: string;
}) {
  return (
    <Dialog
      open={!!renameState.nodeId}
      onOpenChange={(open) => {
        if (!open) setRenameState({ nodeId: null, value: "", original: "" });
      }}
    >
      {renameState.nodeId ? (
        <DialogContent
          className={nestedDialogClassName}
          overlayClassName={nestedDialogOverlayClassName}
        >
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="New name"
              value={renameState.value}
              onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameState({ nodeId: null, value: "", original: "" })}
            >
              Cancel
            </Button>
            <Button onClick={() => void confirmRename()} disabled={!canEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function DeleteDialog({
  deleteDialog,
  setDeleteDialog,
  confirmDelete,
  canEdit,
  nestedDialogClassName,
  nestedDialogOverlayClassName,
}: {
  deleteDialog: { open: boolean; nodes: ProjectNode[] };
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ open: boolean; nodes: ProjectNode[] }>>;
  confirmDelete: () => Promise<void>;
  canEdit: boolean;
  nestedDialogClassName?: string;
  nestedDialogOverlayClassName?: string;
}) {
  return (
    <Dialog
      open={deleteDialog.open}
      onOpenChange={(open) =>
        setDeleteDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
      }
    >
      <DialogContent
        className={nestedDialogClassName}
        overlayClassName={nestedDialogOverlayClassName}
      >
        <DialogHeader>
          <DialogTitle>Move to Trash</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          This will move{" "}
          <span className="font-mono font-semibold">
            {deleteDialog.nodes.length > 1
              ? `${deleteDialog.nodes.length} items`
              : deleteDialog.nodes[0]?.name}
          </span>{" "}
          to Trash.
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteDialog({ open: false, nodes: [] })}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={!canEdit}
          >
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  moveDialog,
  setMoveDialog,
  confirmMove,
  canEdit,
  projectId,
  nestedDialogClassName,
  nestedDialogOverlayClassName,
}: {
  moveDialog: {
    open: boolean;
    nodes: ProjectNode[];
    targetFolderId: string | null;
  };
  setMoveDialog: React.Dispatch<
    React.SetStateAction<{
      open: boolean;
      nodes: ProjectNode[];
      targetFolderId: string | null;
    }>
  >;
  confirmMove: () => Promise<void>;
  canEdit: boolean;
  projectId: string;
  nestedDialogClassName?: string;
  nestedDialogOverlayClassName?: string;
}) {
  return (
    <Dialog
      open={moveDialog.open}
      onOpenChange={(open) =>
        setMoveDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
      }
    >
      <DialogContent
        className={nestedDialogClassName}
        overlayClassName={nestedDialogOverlayClassName}
      >
        <DialogHeader>
          <DialogTitle>Move</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            Move{" "}
            <span className="font-mono font-semibold">
              {moveDialog.nodes.length > 1
                ? `${moveDialog.nodes.length} items`
                : moveDialog.nodes[0]?.name}
            </span>{" "}
            to:
          </div>
          <FolderPicker
            projectId={projectId}
            selectedFolderId={moveDialog.targetFolderId}
            onSelectFolder={(id) => setMoveDialog((d) => ({ ...d, targetFolderId: id }))}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              setMoveDialog({ open: false, nodes: [], targetFolderId: null })
            }
          >
            Cancel
          </Button>
          <Button onClick={() => void confirmMove()} disabled={!canEdit}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
