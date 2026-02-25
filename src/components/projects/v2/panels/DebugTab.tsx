"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { Bug, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

interface DebugTabProps {
  projectId: string;
}

export function DebugTab({ projectId }: DebugTabProps) {
  const lines = useFilesWorkspaceStore((s) => s._get(projectId).ui.debugOutput ?? []);
  const clearDebugOutput = useFilesWorkspaceStore((s) => s.clearDebugOutput);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const handleClear = useCallback(() => {
    clearDebugOutput(projectId);
  }, [projectId, clearDebugOutput]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <span className="text-xs text-zinc-500 mr-auto flex items-center gap-1">
          <Bug className="w-3 h-3" />
          Debug Console
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={handleClear} disabled={lines.length === 0} title="Clear">
          <Eraser className="w-3 h-3" />
        </Button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto font-mono text-xs px-3 py-2 whitespace-pre-wrap break-words bg-zinc-50 dark:bg-zinc-950"
      >
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Bug className="w-8 h-8 mb-2 opacity-40" />
            <span className="text-sm">No debug output yet</span>
            <span className="text-xs mt-1">Run a file to see console.log / print output here</span>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="leading-5 text-zinc-800 dark:text-zinc-200">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
