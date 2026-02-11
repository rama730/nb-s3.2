"use client";

import React from "react";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { cn } from "@/lib/utils";
import { FileText, Circle } from "lucide-react";

export default function SourceControlPanel({ projectId, className }: { projectId: string; className?: string }) {
  const fileStates = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.fileStates || {});
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || {});
  const openTab = useFilesWorkspaceStore((s) => s.openTab);

  const dirtyFiles = Object.entries(fileStates)
    .filter(([, state]) => state.isDirty)
    .map(([id]) => nodesById[id])
    .filter(Boolean);

  if (dirtyFiles.length === 0) {
      return <div className={cn("p-4 text-xs text-zinc-400 italic text-center", className)}>No changed files</div>;
  }

  return (
      <div className={cn("flex flex-col py-2", className)}>
          {dirtyFiles.map(node => (
              <div 
                key={node.id}
                className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs group"
                onClick={() => openTab(projectId, "left", node.id)}
                title={node.name}
              >
                  <FileText className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <span className="truncate flex-1 text-amber-700 dark:text-amber-400">{node.name}</span>
                  <Circle className="w-2 h-2 fill-amber-500 text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[10px] text-zinc-400 opacity-60">M</span>
              </div>
          ))}
      </div>
  );
}
