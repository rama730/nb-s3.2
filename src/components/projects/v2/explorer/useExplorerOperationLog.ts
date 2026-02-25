"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/components/ui-custom/Toast";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";

export function useExplorerOperationLog() {
  const { showToast } = useToast();
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [operations, setOperations] = useState<ExplorerOperation[]>([]);
  const operationsRef = useRef<ExplorerOperation[]>([]);

  const syncOperations = useCallback((next: ExplorerOperation[]) => {
    operationsRef.current = next;
    setOperations(next);
  }, []);

  const recordOperation = useCallback(
    (operation: Omit<ExplorerOperation, "id" | "at">) => {
      const entry: ExplorerOperation = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        ...operation,
      };
      syncOperations([entry, ...operationsRef.current].slice(0, 30));
    },
    [syncOperations]
  );

  const executeUndo = useCallback(
    async (operationId: string) => {
      const operation = operationsRef.current.find((entry) => entry.id === operationId);
      if (!operation?.undo) return;
      syncOperations(
        operationsRef.current.map((entry) =>
          entry.id === operationId ? { ...entry, status: "running" } : entry
        )
      );
      try {
        await operation.undo.run();
        syncOperations(
          operationsRef.current.map((entry) =>
            entry.id === operationId
              ? { ...entry, status: "success", undo: undefined, label: `${entry.label} (undone)` }
              : entry
          )
        );
      } catch (error: unknown) {
        syncOperations(
          operationsRef.current.map((entry) =>
            entry.id === operationId
              ? { ...entry, status: "error", label: `${entry.label} (undo failed)` }
              : entry
          )
        );
        showToast(`Undo failed: ${getErrorMessage(error, "Unknown error")}`, "error");
      }
    },
    [showToast, syncOperations]
  );

  const clearOperations = useCallback(() => {
    syncOperations([]);
  }, [syncOperations]);

  return {
    operationsOpen,
    setOperationsOpen,
    operations,
    setOperations,
    recordOperation,
    executeUndo,
    clearOperations,
  };
}
