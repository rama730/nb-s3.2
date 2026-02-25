"use client";

import React from "react";
import { Loader2, ShieldCheck, ShieldX, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExplorerOperation } from "./explorerTypes";

interface ExplorerOperationsHostProps {
  operationsOpen: boolean;
  operations: ExplorerOperation[];
  onClear: () => void;
  onUndo: (operationId: string) => void;
}

export function ExplorerOperationsHost({
  operationsOpen,
  operations,
  onClear,
  onUndo,
}: ExplorerOperationsHostProps) {
  if (!operationsOpen) return null;

  return (
    <div className="flex-none border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          Operation Center
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onClear}
          disabled={operations.length === 0}
        >
          Clear
        </Button>
      </div>
      <div className="max-h-28 overflow-auto px-2 pb-2 space-y-1">
        {operations.length === 0 ? (
          <div className="text-[11px] text-zinc-500 px-1 py-1">No recent operations.</div>
        ) : (
          operations.map((op) => (
            <div
              key={op.id}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] flex items-center gap-2"
            >
              {op.status === "success" ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              ) : op.status === "error" ? (
                <ShieldX className="w-3.5 h-3.5 text-red-500" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
              )}
              <span className="truncate text-zinc-700 dark:text-zinc-300">{op.label}</span>
              {op.undo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 ml-auto text-[10px]"
                  onClick={() => onUndo(op.id)}
                >
                  <Undo2 className="w-3 h-3 mr-1" />
                  {op.undo.label}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
