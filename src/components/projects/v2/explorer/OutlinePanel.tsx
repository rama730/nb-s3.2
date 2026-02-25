"use client";

import React from "react";
import { useFilesWorkspaceStore, type EditorSymbol } from "@/stores/filesWorkspaceStore";
import { SymbolKind } from "@/stores/files/types";
import { cn } from "@/lib/utils";
import { Box, Braces, Code2, Variable, FunctionSquare } from "lucide-react";

interface OutlinePanelProps {
  projectId: string;
  className?: string;
}

const SymbolIcon = ({ kind }: { kind: SymbolKind }) => {
  if (kind === SymbolKind.Class || kind === SymbolKind.Interface)
    return <Box className="w-3.5 h-3.5 text-orange-500" />;
  if (kind === SymbolKind.Method || kind === SymbolKind.Function)
    return <FunctionSquare className="w-3.5 h-3.5 text-purple-500" />;
  if (kind === SymbolKind.Variable || kind === SymbolKind.Constant || kind === SymbolKind.Property || kind === SymbolKind.Field)
    return <Variable className="w-3.5 h-3.5 text-blue-500" />;
  if (kind === SymbolKind.Enum)
    return <Braces className="w-3.5 h-3.5 text-yellow-500" />;

  return <Code2 className="w-3.5 h-3.5 text-zinc-500" />;
};

export default function OutlinePanel({ projectId, className }: OutlinePanelProps) {
  const activeFileSymbols = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.activeFileSymbols || []);
  const activeTabId = useFilesWorkspaceStore((s) => {
     // Try to get active tab from active pane
     const ws = s.byProjectId[projectId];
     return ws?.panes?.left?.activeTabId || ws?.panes?.right?.activeTabId;
  });
  
  const requestScrollTo = useFilesWorkspaceStore((s) => s.requestScrollTo);

  const handleSymbolClick = (symbol: EditorSymbol) => {
      if (!activeTabId) return;
      requestScrollTo(projectId, activeTabId, symbol.range.startLineNumber);
  };

  const renderSymbol = (symbol: EditorSymbol, depth: number) => {
    return (
      <div key={`${symbol.name}-${symbol.range.startLineNumber}`} className="flex flex-col">
        <div 
            className={cn(
                "flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-xs select-none",
                "text-zinc-700 dark:text-zinc-300 transition-colors"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => handleSymbolClick(symbol)}
        >
          <SymbolIcon kind={symbol.kind} />
          <span className="truncate">{symbol.name}</span>
        </div>
        {symbol.children?.map(child => renderSymbol(child, depth + 1))}
      </div>
    );
  };

  if (activeFileSymbols.length === 0) {
    return (
      <div className={cn("p-4 text-xs text-zinc-400 text-center italic", className)}>
        No outline available
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col py-2", className)}>
      {activeFileSymbols.map(s => renderSymbol(s, 0))}
    </div>
  );
}
