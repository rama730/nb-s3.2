"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";

export type CommandEntry = {
  id: string;
  label: string;
  run: () => void | Promise<void>;
  disabled?: boolean;
  requiresWrite?: boolean;
};

export function ExplorerCommandPalette({
  commandPalette,
  setCommandPalette,
  canEdit,
  selectedNode,
  storeSelectedNodeIds,
  nodesById,
  openCreate,
  openRename,
  openMove,
  openDelete,
  handleSelect,
  toggleFavorite,
  getNodePath,
  projectId,
  nestedDialogClassName,
  nestedDialogOverlayClassName,
}: {
  commandPalette: { open: boolean; query: string };
  setCommandPalette: React.Dispatch<
    React.SetStateAction<{ open: boolean; query: string }>
  >;
  canEdit: boolean;
  selectedNode: ProjectNode | null;
  storeSelectedNodeIds: string[];
  nodesById: Record<string, ProjectNode>;
  openCreate: (kind: "file" | "folder") => void;
  openRename: (node: ProjectNode) => void;
  openMove: (nodeOrNodes: ProjectNode | ProjectNode[]) => void;
  openDelete: (nodeOrNodes: ProjectNode | ProjectNode[]) => void;
  handleSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
  toggleFavorite: (projectId: string, nodeId: string) => void;
  getNodePath: (node: ProjectNode | null | undefined) => string;
  projectId: string;
  nestedDialogClassName?: string;
  nestedDialogOverlayClassName?: string;
}) {
  const commands: CommandEntry[] = [
    {
      id: "open",
      label: "Open selected",
      run: () => { if (selectedNode) handleSelect(selectedNode); },
      disabled: !selectedNode,
      requiresWrite: false,
    },
    { id: "newFile", label: "New file", run: () => openCreate("file") },
    { id: "newFolder", label: "New folder", run: () => openCreate("folder") },
    {
      id: "rename",
      label: "Rename selected",
      run: () => { if (selectedNode) openRename(selectedNode); },
      disabled: !selectedNode || storeSelectedNodeIds.length > 1,
    },
    {
      id: "delete",
      label: "Delete selected",
      run: () => {
        if (storeSelectedNodeIds.length > 0) {
          const nodes = storeSelectedNodeIds
            .map((id) => nodesById[id])
            .filter(Boolean);
          openDelete(nodes);
        } else if (selectedNode) {
          openDelete(selectedNode);
        }
      },
      disabled: !selectedNode && storeSelectedNodeIds.length === 0,
    },
    {
      id: "toggleFav",
      label: "Toggle favorite",
      run: () => { if (selectedNode) toggleFavorite(projectId, selectedNode.id); },
      disabled: !selectedNode,
    },
    {
      id: "move",
      label: "Move selected",
      run: () => {
        if (storeSelectedNodeIds.length > 0) {
          const nodes = storeSelectedNodeIds
            .map((id) => nodesById[id])
            .filter(Boolean);
          openMove(nodes);
        } else if (selectedNode) {
          openMove(selectedNode);
        }
      },
      disabled: !selectedNode && storeSelectedNodeIds.length === 0,
    },
    {
      id: "copyPath",
      label: "Copy selected path",
      run: async () => {
        if (!selectedNode) return;
        const path = getNodePath(selectedNode);
        if (!path) return;
        await navigator.clipboard.writeText(path);
      },
      disabled: !selectedNode,
      requiresWrite: false,
    },
  ];

  const filteredCommands = commands.filter((c) =>
    c.label.toLowerCase().includes(commandPalette.query.trim().toLowerCase())
  );

  return (
    <Dialog
      open={commandPalette.open}
      onOpenChange={(open) => setCommandPalette((s) => ({ ...s, open }))}
    >
      <DialogContent
        className={nestedDialogClassName}
        overlayClassName={nestedDialogOverlayClassName}
      >
        <DialogHeader>
          <DialogTitle>Commands</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            placeholder="Type a command…"
            value={commandPalette.query}
            onChange={(e) =>
              setCommandPalette((s) => ({ ...s, query: e.target.value }))
            }
          />
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {filteredCommands.map((c) => (
              <button
                key={c.id}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900",
                  c.disabled && "opacity-50 cursor-not-allowed"
                )}
                disabled={!!c.disabled || (c.requiresWrite !== false && !canEdit)}
                onClick={async () => {
                  if (c.disabled || (c.requiresWrite !== false && !canEdit)) return;
                  setCommandPalette({ open: false, query: "" });
                  await c.run();
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCommandPalette({ open: false, query: "" })}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
