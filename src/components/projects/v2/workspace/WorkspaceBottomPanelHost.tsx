"use client";

import React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { Problem } from "@/stores/files/types";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import { BottomPanel } from "../panels/BottomPanel";

interface WorkspaceBottomPanelHostProps {
  projectId: string;
  canEdit: boolean;
  problems: Problem[];
  activeFilePath?: string;
  activePane: PaneId;
  activeTabIdByPane: Record<PaneId, string | null>;
  tabById: Record<string, FilesWorkspaceTabState>;
  nodesById: Record<string, ProjectNode>;
  onRunActiveFile: () => void;
  onOpenNode: (node: ProjectNode, paneId: PaneId) => void;
}

export function WorkspaceBottomPanelHost({
  projectId,
  canEdit,
  problems,
  activeFilePath,
  activePane,
  activeTabIdByPane,
  tabById,
  nodesById,
  onRunActiveFile,
  onOpenNode,
}: WorkspaceBottomPanelHostProps) {
  return (
    <BottomPanel
      projectId={projectId}
      canEdit={canEdit}
      problems={problems}
      activeFilePath={activeFilePath}
      onRun={onRunActiveFile}
      activeFileContent={
        (() => {
          const id = activeTabIdByPane[activePane];
          return id ? tabById[id]?.content : undefined;
        })()
      }
      onNavigateToFile={(nodeId) => {
        const node = nodesById[nodeId];
        if (node) void onOpenNode(node, activePane);
      }}
    />
  );
}
