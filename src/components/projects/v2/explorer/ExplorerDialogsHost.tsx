"use client";

import React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { CreateDialog, DeleteDialog, MoveDialog, RenameDialog } from "./ExplorerBatchOps";
import { ExplorerQuickOpen } from "./ExplorerQuickOpen";
import { ExplorerCommandPalette } from "./ExplorerCommandPalette";

interface ExplorerDialogsHostProps {
  canEdit: boolean;
  projectId: string;
  createDialog: { open: false } | { open: true; kind: "file" | "folder"; parentId: string | null; name: string };
  setCreateDialog: React.Dispatch<
    React.SetStateAction<{ open: false } | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }>
  >;
  confirmCreate: () => Promise<void>;
  renameState: { nodeId: string | null; value: string; original: string };
  setRenameState: React.Dispatch<
    React.SetStateAction<{ nodeId: string | null; value: string; original: string }>
  >;
  confirmRename: () => Promise<void>;
  deleteDialog: { open: boolean; nodes: ProjectNode[] };
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ open: boolean; nodes: ProjectNode[] }>>;
  confirmDelete: () => Promise<void>;
  moveDialog: { open: boolean; nodes: ProjectNode[]; targetFolderId: string | null };
  setMoveDialog: React.Dispatch<
    React.SetStateAction<{ open: boolean; nodes: ProjectNode[]; targetFolderId: string | null }>
  >;
  confirmMove: () => Promise<void>;
  quickOpen: { open: boolean; query: string };
  setQuickOpen: React.Dispatch<React.SetStateAction<{ open: boolean; query: string }>>;
  commandPalette: { open: boolean; query: string };
  setCommandPalette: React.Dispatch<React.SetStateAction<{ open: boolean; query: string }>>;
  selectedNode: ProjectNode | null;
  storeSelectedNodeIds: string[];
  nodesById: Record<string, ProjectNode>;
  recents: string[];
  handleSelect: (node: ProjectNode) => void;
  openCreate: (kind: "file" | "folder") => void;
  openRename: (node: ProjectNode) => void;
  openMove: (nodeOrNodes: ProjectNode | ProjectNode[]) => void;
  openDelete: (nodeOrNodes: ProjectNode | ProjectNode[]) => void;
  toggleFavorite: (projectId: string, nodeId: string) => void;
  getNodePath: (node: ProjectNode | null | undefined) => string;
  mode: "default" | "select";
}

// FW10: Memoize to prevent re-renders from unrelated ExplorerShell state changes
export const ExplorerDialogsHost = React.memo(function ExplorerDialogsHost({
  canEdit,
  projectId,
  createDialog,
  setCreateDialog,
  confirmCreate,
  renameState,
  setRenameState,
  confirmRename,
  deleteDialog,
  setDeleteDialog,
  confirmDelete,
  moveDialog,
  setMoveDialog,
  confirmMove,
  quickOpen,
  setQuickOpen,
  commandPalette,
  setCommandPalette,
  selectedNode,
  storeSelectedNodeIds,
  nodesById,
  recents,
  handleSelect,
  openCreate,
  openRename,
  openMove,
  openDelete,
  toggleFavorite,
  getNodePath,
  mode,
}: ExplorerDialogsHostProps) {
  const nestedDialogClassName = mode === "select" ? "z-[360]" : undefined;
  const nestedDialogOverlayClassName = mode === "select" ? "z-[350]" : undefined;

  return (
    <>
      <CreateDialog
        createDialog={createDialog}
        setCreateDialog={setCreateDialog}
        confirmCreate={confirmCreate}
        canEdit={canEdit}
        nestedDialogClassName={nestedDialogClassName}
        nestedDialogOverlayClassName={nestedDialogOverlayClassName}
      />

      <RenameDialog
        renameState={renameState}
        setRenameState={setRenameState}
        confirmRename={confirmRename}
        canEdit={canEdit}
        nestedDialogClassName={nestedDialogClassName}
        nestedDialogOverlayClassName={nestedDialogOverlayClassName}
      />

      <DeleteDialog
        deleteDialog={deleteDialog}
        setDeleteDialog={setDeleteDialog}
        confirmDelete={confirmDelete}
        canEdit={canEdit}
        nestedDialogClassName={nestedDialogClassName}
        nestedDialogOverlayClassName={nestedDialogOverlayClassName}
      />

      <MoveDialog
        moveDialog={moveDialog}
        setMoveDialog={setMoveDialog}
        confirmMove={confirmMove}
        canEdit={canEdit}
        projectId={projectId}
        nestedDialogClassName={nestedDialogClassName}
        nestedDialogOverlayClassName={nestedDialogOverlayClassName}
      />

      <ExplorerQuickOpen
        quickOpen={quickOpen}
        setQuickOpen={setQuickOpen}
        projectId={projectId}
        nodesById={nodesById}
        recents={recents}
        handleSelect={handleSelect}
        nestedDialogClassName={nestedDialogClassName}
        nestedDialogOverlayClassName={nestedDialogOverlayClassName}
      />

      <ExplorerCommandPalette
        commandPalette={commandPalette}
        setCommandPalette={setCommandPalette}
        canEdit={canEdit}
        selectedNode={selectedNode}
        storeSelectedNodeIds={storeSelectedNodeIds}
        nodesById={nodesById}
        openCreate={openCreate}
        openRename={openRename}
        openMove={openMove}
        openDelete={openDelete}
        handleSelect={handleSelect}
        toggleFavorite={toggleFavorite}
        getNodePath={getNodePath}
        projectId={projectId}
        nestedDialogClassName={nestedDialogClassName}
        nestedDialogOverlayClassName={nestedDialogOverlayClassName}
      />
    </>
  );
});
