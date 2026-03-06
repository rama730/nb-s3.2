import { useEffect, useRef } from "react";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import { lintFileAction, getNodeDisplayPath } from "@/app/actions/lint";
import { getFileContent, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

const LINT_DEBOUNCE_MS = 500;
const LINT_EXTS = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx", ".py"]);

interface UseLintOnEditOptions {
  projectId: string;
  canEdit: boolean;
  panesToRender: PaneId[];
  activeTabIdByPane: Record<PaneId, string | null>;
  tabByIdRef: React.RefObject<Record<string, FilesWorkspaceTabState>>;
  leftActiveTab: FilesWorkspaceTabState | null;
  rightActiveTab: FilesWorkspaceTabState | null;
}

export function useLintOnEdit({
  projectId,
  canEdit,
  panesToRender,
  activeTabIdByPane,
  tabByIdRef,
  leftActiveTab,
  rightActiveTab,
}: UseLintOnEditOptions) {
  const setProblems = useFilesWorkspaceStore((s) => s.setProblems);
  const timerRef = useRef<Record<PaneId, ReturnType<typeof setTimeout> | null>>({
    left: null,
    right: null,
  });

  useEffect(() => {
    if (!canEdit) return;

    const runLint = async (nodeId: string, content: string, filePath: string) => {
      const ext = filePath.includes(".") ? "." + filePath.split(".").pop()!.toLowerCase() : "";
      if (!LINT_EXTS.has(ext)) return;

      const res = await lintFileAction(projectId, nodeId, content, filePath);
      if (!res.ok) return;

      const existing = useFilesWorkspaceStore.getState()._get(projectId).ui.problems ?? [];
      const merged = [
        ...existing.filter((p) => p.source !== "linter" || p.nodeId !== nodeId),
        ...res.problems,
      ];
      setProblems(projectId, merged);
    };

    for (const paneId of panesToRender) {
      const t = timerRef.current[paneId];
      if (t) clearTimeout(t);
      const tabId = activeTabIdByPane[paneId];
      const tab = tabId ? tabByIdRef.current[tabId] : null;
      if (!tab?.node || !tabId) continue;

      const name = tab.node.name;
      const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
      if (!LINT_EXTS.has(ext)) continue;

      const nodeIdForLint = tabId;
      timerRef.current[paneId] = setTimeout(() => {
        const currentTab = tabByIdRef.current[nodeIdForLint];
        if (!currentTab?.node) return;
        void (async () => {
          const filePath = await getNodeDisplayPath(projectId, nodeIdForLint);
          if (filePath) {
            const lintContent = getFileContent(projectId, nodeIdForLint);
            void runLint(nodeIdForLint, lintContent, filePath);
          }
        })();
        timerRef.current[paneId] = null;
      }, LINT_DEBOUNCE_MS);
    }

    return () => {
      for (const paneId of panesToRender) {
        if (timerRef.current[paneId]) clearTimeout(timerRef.current[paneId]!);
      }
    };
  }, [
    projectId,
    canEdit,
    panesToRender,
    activeTabIdByPane,
    setProblems,
    leftActiveTab?.contentVersion,
    leftActiveTab?.id,
    rightActiveTab?.contentVersion,
    rightActiveTab?.id,
  ]);
}
