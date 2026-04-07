import type { ProjectNode } from "@/lib/db/schema";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";

export type ExplorerOperation = {
  id: string;
  label: string;
  status: "success" | "error" | "running";
  at: number;
  undo?: { label: string; run: () => Promise<void> };
};

export type ExplorerProps = {
  projectId: string;
  projectName?: string;
  canEdit: boolean;
  isActive?: boolean;
  viewMode?: import("@/stores/filesWorkspaceStore").FilesViewMode;
  onOpenFile: (node: ProjectNode) => void;
  onNodeDeleted?: (nodeId: string) => void;
  mode?: "default" | "select";
  selectedNodeIds?: string[];
  onSelectionChange?: (nodeIds: string[]) => void;
  syncStatus?: string;
};

export const EMPTY_OBJECT: Record<string, never> = {};
export const EMPTY_ARRAY: string[] = [];

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function areIdListsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export const EXPLORER_RUNTIME_BUDGETS = FILES_RUNTIME_BUDGETS;
