import { useEffect, useRef } from "react";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { recordFilesMetric } from "@/lib/files/observability";
import { FILES_RUNTIME_BUDGETS, clampNumber } from "@/lib/files/runtime-budgets";

const BACKGROUND_AUTOSAVE_INTERVAL_MS = 15_000;

interface UseAutoSaveOptions {
  projectId: string;
  canEdit: boolean;
  panesToRender: PaneId[];
  activeTabIdByPane: Record<PaneId, string | null>;
  tabByIdRef: React.RefObject<Record<string, FilesWorkspaceTabState>>;
  saveTab: (nodeId: string, opts?: { silent?: boolean; reason?: string }) => Promise<boolean>;
  autosaveDelayMs?: number;
  backgroundConcurrency?: number;
  leftActiveTab: FilesWorkspaceTabState | null;
  rightActiveTab: FilesWorkspaceTabState | null;
  leftActiveTabId: string | null | undefined;
  rightActiveTabId: string | null | undefined;
}

export function useAutoSave({
  projectId,
  canEdit,
  panesToRender,
  activeTabIdByPane,
  tabByIdRef,
  saveTab,
  autosaveDelayMs,
  backgroundConcurrency,
  leftActiveTab,
  rightActiveTab,
  leftActiveTabId,
  rightActiveTabId,
}: UseAutoSaveOptions) {
  const effectiveAutosaveDelayMs = clampNumber(
    autosaveDelayMs ?? FILES_RUNTIME_BUDGETS.autosaveDelayDefaultMs,
    FILES_RUNTIME_BUDGETS.autosaveDelayMinMs,
    FILES_RUNTIME_BUDGETS.autosaveDelayMaxMs
  );
  const effectiveBackgroundConcurrency = clampNumber(
    backgroundConcurrency ?? FILES_RUNTIME_BUDGETS.backgroundAutosaveDefaultConcurrency,
    1,
    FILES_RUNTIME_BUDGETS.backgroundAutosaveMaxConcurrency
  );

  const autosaveTimerRef = useRef<Record<PaneId, ReturnType<typeof setTimeout> | null>>({
    left: null,
    right: null,
  });
  const prevActiveRef = useRef<Record<PaneId, string | null>>({ left: null, right: null });

  // Save previous active tab on switch (best-effort)
  useEffect(() => {
    for (const paneId of panesToRender) {
      const prev = prevActiveRef.current[paneId];
      const current = activeTabIdByPane[paneId];
      if (prev && prev !== current) {
        const prevTab = tabByIdRef.current[prev];
        if (prevTab?.isDirty && canEdit) void saveTab(prev, { silent: true, reason: "switch" });
      }
      prevActiveRef.current[paneId] = current;
    }
  }, [activeTabIdByPane, canEdit, panesToRender, saveTab, leftActiveTabId, rightActiveTabId]);

  // Debounced autosave per pane active tab (2.5s)
  useEffect(() => {
    const paneTimers = autosaveTimerRef.current;
    for (const paneId of panesToRender) {
      if (paneTimers[paneId]) clearTimeout(paneTimers[paneId]!);
      const id = activeTabIdByPane[paneId];
      if (!id || !canEdit) continue;
      const tab = tabByIdRef.current[id];
      if (!tab || !tab.isDirty || tab.isSaving) continue;

      paneTimers[paneId] = setTimeout(() => {
        void saveTab(id, { silent: true, reason: "autosave" })
          .then((ok) => {
            recordFilesMetric(ok ? "files.autosave.success_count" : "files.autosave.failure_count", {
              projectId,
              nodeId: id,
              value: 1,
              extra: { reason: "active-tab" },
            });
          })
          .catch(() => {
            recordFilesMetric("files.autosave.failure_count", {
              projectId,
              nodeId: id,
              value: 1,
              extra: { reason: "active-tab" },
            });
          });
      }, effectiveAutosaveDelayMs);
    }
    return () => {
      for (const paneId of panesToRender) {
        if (paneTimers[paneId]) clearTimeout(paneTimers[paneId]!);
      }
    };
  }, [
    activeTabIdByPane,
    canEdit,
    panesToRender,
    saveTab,
    effectiveAutosaveDelayMs,
    leftActiveTab?.content,
    leftActiveTab?.isDirty,
    leftActiveTab?.isSaving,
    rightActiveTab?.content,
    rightActiveTab?.isDirty,
    rightActiveTab?.isSaving,
  ]);

  // Background autosave for dirty inactive tabs (15s)
  useEffect(() => {
    if (!canEdit) return;
    const cleanup = createVisibilityAwareInterval(() => {
      const activeIds = new Set<string>();
      for (const paneId of panesToRender) {
        const id = activeTabIdByPane[paneId];
        if (id) activeIds.add(id);
      }
      const dirtyInactiveIds = Object.values(tabByIdRef.current)
        .filter((tab) => tab.isDirty && !tab.isSaving && !activeIds.has(tab.id))
        .map((tab) => tab.id)
        .slice(0, 12);
      if (dirtyInactiveIds.length === 0) return;
      void runWithConcurrency(dirtyInactiveIds, effectiveBackgroundConcurrency, async (nodeId) => {
        try {
          const ok = await saveTab(nodeId, { silent: true, reason: "background" });
          recordFilesMetric(ok ? "files.autosave.success_count" : "files.autosave.failure_count", {
            projectId,
            nodeId,
            value: 1,
            extra: { reason: "background" },
          });
        } catch {
          recordFilesMetric("files.autosave.failure_count", {
            projectId,
            nodeId,
            value: 1,
            extra: { reason: "background" },
          });
        }
      });
    }, BACKGROUND_AUTOSAVE_INTERVAL_MS);
    return cleanup;
  }, [activeTabIdByPane, canEdit, effectiveBackgroundConcurrency, panesToRender, projectId, saveTab, tabByIdRef]);
}
