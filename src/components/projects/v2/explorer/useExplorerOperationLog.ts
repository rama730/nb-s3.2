"use client";

import { toast } from "sonner";
import { useCallback } from "react";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";

export function useExplorerOperationLog() {
  // Reuse notifications: the previous in-memory log had no rendered consumer.
  const recordOperation = useCallback((operation: Omit<ExplorerOperation, "id" | "at">) => {
    if (!operation.undo) return; // Other operations already report their outcome.
    let running = false;
    let completed = false;
    const undo = async () => {
      if (running || completed) return;
      running = true;
      const id = toast.loading("Undoing change…");
      try {
        await operation.undo!.run();
        completed = true;
        toast.success("Change undone", { id });
      } catch (error) {
        toast.error(`Undo failed: ${getErrorMessage(error, "Try again")}`, {
          id, action: { label: "Retry", onClick: () => { void undo(); } },
        });
      } finally {
        running = false;
      }
    };
    toast.success(operation.label, {
      duration: 10000,
      action: { label: operation.undo.label, onClick: () => { void undo(); } },
    });
  }, []);
  return { recordOperation };
}
