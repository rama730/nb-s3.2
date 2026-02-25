"use client";

import React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import WorkspaceSearchReplace from "./WorkspaceSearchReplace";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";

interface WorkspaceModalsHostProps {
  projectId: string;
  canEdit: boolean;
  activePane: PaneId;
  findOpen: boolean;
  setFindOpen: (open: boolean) => void;
  quickOpenOpen: boolean;
  setQuickOpenOpen: (open: boolean) => void;
  quickOpenQuery: string;
  setQuickOpenQuery: (query: string) => void;
  quickOpenResults: ProjectNode[];
  nodePathById: Map<string, string>;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  commandQuery: string;
  setCommandQuery: (query: string) => void;
  filteredCommandActions: Array<{ id: string; label: string; run: () => void }>;
  conflictDialog: { open: boolean; nodeId: string | null; message: string; diffSignal: number };
  setConflictDialog: React.Dispatch<
    React.SetStateAction<{ open: boolean; nodeId: string | null; message: string; diffSignal: number }>
  >;
  getPaneForTab: (nodeId: string) => PaneId | null;
  setActivePane: (pane: PaneId) => void;
  nodesById: Record<string, ProjectNode>;
  openFileInPane: (node: ProjectNode, paneId?: PaneId) => Promise<void>;
  ensureNodeMetadata: (nodeIds: string[]) => Promise<void>;
  loadFileContent: (node: ProjectNode) => Promise<void>;
  tabByIdRef: React.MutableRefObject<Record<string, FilesWorkspaceTabState>>;
}

export function WorkspaceModalsHost({
  projectId,
  canEdit,
  activePane,
  findOpen,
  setFindOpen,
  quickOpenOpen,
  setQuickOpenOpen,
  quickOpenQuery,
  setQuickOpenQuery,
  quickOpenResults,
  nodePathById,
  commandOpen,
  setCommandOpen,
  commandQuery,
  setCommandQuery,
  filteredCommandActions,
  conflictDialog,
  setConflictDialog,
  getPaneForTab,
  setActivePane,
  nodesById,
  openFileInPane,
  ensureNodeMetadata,
  loadFileContent,
  tabByIdRef,
}: WorkspaceModalsHostProps) {
  return (
    <>
      {quickOpenOpen ? (
        <div className="absolute inset-0 z-20 bg-black/30 flex items-start justify-center p-4 pt-16">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <input
                autoFocus
                className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                placeholder="Quick open files..."
                value={quickOpenQuery}
                onChange={(e) => setQuickOpenQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuickOpenOpen(false);
                    return;
                  }
                  if (e.key === "Enter" && quickOpenResults[0]) {
                    e.preventDefault();
                    void openFileInPane(quickOpenResults[0], activePane);
                    setQuickOpenOpen(false);
                    setQuickOpenQuery("");
                  }
                }}
              />
            </div>
            <div className="max-h-[60vh] overflow-auto divide-y divide-zinc-200 dark:divide-zinc-800">
              {quickOpenResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-zinc-500">No matching files</div>
              ) : (
                quickOpenResults.map((node) => (
                  <button
                    key={node.id}
                    className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    onClick={() => {
                      void openFileInPane(node, activePane);
                      setQuickOpenOpen(false);
                      setQuickOpenQuery("");
                    }}
                  >
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {node.name}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {nodePathById.get(node.id) || node.name}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {commandOpen ? (
        <div className="absolute inset-0 z-20 bg-black/30 flex items-start justify-center p-4 pt-16">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <input
                autoFocus
                className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                placeholder="Type a command..."
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCommandOpen(false);
                    return;
                  }
                  if (e.key === "Enter" && filteredCommandActions[0]) {
                    e.preventDefault();
                    filteredCommandActions[0].run();
                    setCommandOpen(false);
                    setCommandQuery("");
                  }
                }}
              />
            </div>
            <div className="max-h-[50vh] overflow-auto divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredCommandActions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-zinc-500">No command found</div>
              ) : (
                filteredCommandActions.map((action) => (
                  <button
                    key={action.id}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    onClick={() => {
                      action.run();
                      setCommandOpen(false);
                      setCommandQuery("");
                    }}
                  >
                    {action.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {findOpen ? (
        <WorkspaceSearchReplace
          projectId={projectId}
          canEdit={canEdit}
          nodesById={nodesById}
          activePane={activePane}
          openFileInPane={openFileInPane}
          ensureNodeMetadata={ensureNodeMetadata}
          loadFileContent={loadFileContent}
          tabByIdRef={tabByIdRef}
          onClose={() => setFindOpen(false)}
        />
      ) : null}

      <Dialog
        open={conflictDialog.open}
        onOpenChange={(open) =>
          setConflictDialog((prev) => ({
            ...prev,
            open,
            nodeId: open ? prev.nodeId : null,
          }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remote changes detected</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {conflictDialog.message || "This file changed on the server while you were editing."}
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setConflictDialog((prev) => ({
                  ...prev,
                  open: false,
                  nodeId: null,
                }))
              }
            >
              Keep local draft
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const nodeId = conflictDialog.nodeId;
                if (!nodeId) return;
                const pane = getPaneForTab(nodeId) ?? "left";
                setActivePane(pane);
                useFilesWorkspaceStore.getState().setActiveTab(projectId, pane, nodeId);
                setConflictDialog((prev) => ({
                  ...prev,
                  open: false,
                  diffSignal: Date.now(),
                }));
              }}
            >
              Open diff
            </Button>
            <Button
              onClick={() => {
                const nodeId = conflictDialog.nodeId;
                if (!nodeId) return;
                const node = useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
                if (node) {
                  void loadFileContent(node);
                }
                setConflictDialog((prev) => ({
                  ...prev,
                  open: false,
                  nodeId: null,
                }));
              }}
            >
              Reload server copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
