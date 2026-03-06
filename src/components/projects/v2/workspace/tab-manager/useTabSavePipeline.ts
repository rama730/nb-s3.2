import { useCallback, useRef, useState } from "react";
import type React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/client";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import type { FilesWorkspaceTabState, PaneId } from "../../state/filesTabTypes";
import { filesFeatureFlags } from "@/lib/features/files";
import { createFilesCorrelationId, recordFilesMetric } from "@/lib/files/observability";
import {
  getNodesByIds,
  recordProjectNodeEvent,
  refreshProjectNodeLock,
  releaseProjectNodeLock,
  trashNode,
  updateProjectFileStats,
  upsertProjectFileIndex,
} from "@/app/actions/files";
import { isNoOpSave, resolvePostSaveState } from "@/lib/files/save-logic";
import { queueOfflineChange, clearOfflineChange } from "../../hooks/useFilesOfflineQueue";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { isAssetLike, isTextLike } from "../../utils/fileKind";
import type { ConflictDialogState, EnsureSaveResult, TabManagerSharedOptions } from "./types";
import { getErrorMessage } from "./types";
import {
  getFileContent,
  setFileContent as setDetachedContent,
} from "@/stores/filesWorkspaceStore";

const UTF8_ENCODER = new TextEncoder();
const SAVE_ALL_CONCURRENCY = FILES_RUNTIME_BUDGETS.saveAllConcurrency;
const ASYNC_INDEX_MIN_CHARS = 120_000;

interface UseTabSavePipelineOptions extends TabManagerSharedOptions {
  viewMode: FilesViewMode;
  activePane: PaneId;
  setActivePane: (pane: PaneId) => void;
  openTab: (projectId: string, paneId: PaneId, tabId: string) => void;
  closeTabStore: (projectId: string, paneId: PaneId, tabId: string) => void;
  setSelectedNode: (projectId: string, nodeId: string, folderId: string | null) => void;
  acquireLockForNode: (node: ProjectNode) => Promise<void>;
  loadFileContent: (node: ProjectNode) => Promise<void>;
  ensureSignedUrlForNode: (node: ProjectNode) => Promise<string | null>;
  signedUrlCacheRef: React.MutableRefObject<Map<string, { url: string; expiresAt: number }>>;
  enqueueIndexUpdate: (nodeId: string, content: string) => void;
  dirtyTabIds: string[];
  nodesById: Record<string, ProjectNode>;
  setRecentFileIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useTabSavePipeline({
  projectId,
  canEdit,
  showToast,
  setTabById,
  tabByIdRef,
  nextLockAttemptAtRef,
  storeActions,
  viewMode,
  activePane,
  setActivePane,
  openTab,
  closeTabStore,
  setSelectedNode,
  acquireLockForNode,
  loadFileContent,
  ensureSignedUrlForNode,
  signedUrlCacheRef,
  enqueueIndexUpdate,
  dirtyTabIds,
  nodesById,
  setRecentFileIds,
}: UseTabSavePipelineOptions) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const lastServerVersionCheckRef = useRef<Map<string, number>>(new Map());
  const inFlightSaveByNodeRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({
    open: false,
    nodeId: null,
    message: "",
    diffSignal: 0,
  });

  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const ensureSaveGuards = useCallback(
    async (nodeId: string, reason?: string): Promise<EnsureSaveResult> => {
      const tab = tabByIdRef.current[nodeId];
      if (!tab)
        return {
          ok: false,
          code: "tab_missing",
          error: "Tab not found",
        };
      if (!tab.hasLock)
        return {
          ok: false,
          code: "lock_lost",
          error: "File lock lost. Reopen the file and try again.",
        };

      const refreshed = await refreshProjectNodeLock(projectId, nodeId, 120);
      if (!refreshed.ok) {
        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], hasLock: false },
        }));
        storeActions.clearLock(projectId, nodeId);
        return {
          ok: false,
          code: "lock_expired",
          error: "File lock expired. Reopen the file to continue.",
        };
      }

      const now = Date.now();
      const lastCheckedAt = lastServerVersionCheckRef.current.get(nodeId) || 0;
      const shouldCheckVersion = reason !== "autosave" || now - lastCheckedAt > 15000;

      if (shouldCheckVersion) {
        lastServerVersionCheckRef.current.set(nodeId, now);
        const latest = (await getNodesByIds(projectId, [nodeId])) as ProjectNode[];
        const latestNode = latest[0];
        if (!latestNode) {
          return {
            ok: false,
            code: "node_missing",
            error: "File no longer exists.",
          };
        }
        const serverUpdatedAt = new Date(latestNode.updatedAt).getTime();
        const localUpdatedAt = new Date(tab.node.updatedAt).getTime();
        if (serverUpdatedAt > localUpdatedAt + 500) {
          setTabById((prev) => ({
            ...prev,
            [nodeId]: { ...prev[nodeId], node: latestNode },
          }));
          return {
            ok: false,
            code: "version_conflict",
            error: "File changed remotely. Reload and merge before saving.",
          };
        }
      }

      return { ok: true, code: "ok" };
    },
    [projectId, setTabById, storeActions, tabByIdRef]
  );

  const saveTab = useCallback(
    async (
      nodeId: string,
      opts?: { silent?: boolean; reason?: string }
    ): Promise<boolean> => {
      if (!canEdit) return false;
      const existingInFlight = inFlightSaveByNodeRef.current.get(nodeId);
      if (existingInFlight) return existingInFlight;

      const runSave = (async (): Promise<boolean> => {
        const startedAt = performance.now();
        const correlationId = createFilesCorrelationId("save");
        const initialTab = tabByIdRef.current[nodeId];
        if (!initialTab) return false;
        if (!initialTab.node?.s3Key) return false;
        if (!initialTab.isDirty) return true;
        if (initialTab.isSaving) return false;
        if (!initialTab.hasLock) return false;

        if (isNoOpSave(getFileContent(projectId, nodeId), getFileContent(projectId, `${nodeId}::saved`))) {
          storeActions.setFileState(projectId, nodeId, { isDirty: false });
          setTabById((prev) => {
            const current = prev[nodeId];
            if (!current || !current.isDirty) return prev;
            return {
              ...prev,
              [nodeId]: { ...current, isDirty: false, offlineQueued: false },
            };
          });
          return true;
        }

        const guard = await ensureSaveGuards(nodeId, opts?.reason);
        if (!guard.ok) {
          if (guard.code === "version_conflict" && filesFeatureFlags.wave1ConflictUi) {
            setConflictDialog({
              open: true,
              nodeId,
              message: guard.error || "File changed remotely. Reload and merge before saving.",
              diffSignal: Date.now(),
            });
          }
          if (!opts?.silent && guard.error) showToast(guard.error, "error");
          if (guard.code === "version_conflict") {
            recordFilesMetric("files.lock.conflict_count", {
              projectId,
              correlationId,
              nodeId,
              value: 1,
              extra: { reason: "version_conflict" },
            });
          }
          return false;
        }

        const tabForSave = tabByIdRef.current[nodeId];
        if (!tabForSave) return false;
        // Phase 5: Read content from detached Map
        const contentToSave = getFileContent(projectId, nodeId);
        const nodeToSave = tabForSave.node;

        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setTabById((prev) => ({
            ...prev,
            [nodeId]: { ...prev[nodeId], offlineQueued: true },
          }));
          queueOfflineChange(projectId, nodeId, contentToSave);
          if (!opts?.silent) showToast("Offline: changes queued", "success");
          return true;
        }

        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], isSaving: true },
        }));

        try {
          const supabase = getSupabase();
          const blob = new Blob([contentToSave], {
            type: nodeToSave.mimeType || "text/plain",
          });
          const { error } = await supabase.storage
            .from("project-files")
            .update(nodeToSave.s3Key, blob, { upsert: true });
          if (error) throw error;

          const size = UTF8_ENCODER.encode(contentToSave).length;
          const updatedNode = (await updateProjectFileStats(projectId, nodeId, size)) as ProjectNode;
          storeActions.upsertNodes(projectId, [updatedNode]);

          try {
            const ext = nodeToSave.name.split(".").pop()?.toLowerCase();
            const isText =
              (nodeToSave.mimeType || "").startsWith("text/") ||
              ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "sql", "py", "txt"].includes(
                ext || ""
              );
            if (isText) {
              const shouldQueue =
                (filesFeatureFlags.indexAsyncQueue || filesFeatureFlags.wave2AsyncIndexQueue) &&
                contentToSave.length >= ASYNC_INDEX_MIN_CHARS;
              if (shouldQueue) {
                enqueueIndexUpdate(nodeToSave.id, contentToSave);
              } else {
                await upsertProjectFileIndex(projectId, nodeToSave.id, contentToSave);
              }
            }
          } catch { }

          const latestContent = getFileContent(projectId, nodeId) || contentToSave;
          const postSaveState = resolvePostSaveState({
            savedContent: contentToSave,
            currentContent: latestContent,
          });
          const savedAt = Date.now();
          storeActions.setFileState(projectId, nodeId, {
            content: latestContent,
            isDirty: postSaveState.isDirty,
            lastSavedAt: savedAt,
          });
          // Phase 5: Update saved snapshot in detached Map
          setDetachedContent(projectId, `${nodeId}::saved`, postSaveState.savedSnapshot);
          setTabById((prev) => {
            const current = prev[nodeId];
            if (!current) return prev;
            return {
              ...prev,
              [nodeId]: {
                ...current,
                node: updatedNode,
                isSaving: false,
                isDirty: postSaveState.isDirty,
                savedSnapshot: "",
                savedSnapshotVersion: (current.savedSnapshotVersion ?? 0) + 1,
                offlineQueued: false,
                lastSavedAt: savedAt,
              },
            };
          });
          clearOfflineChange(projectId, nodeId);
          try {
            await recordProjectNodeEvent(
              projectId,
              nodeId,
              "save",
              { bytes: size },
              { idempotencyKey: correlationId }
            );
          } catch { }
          recordFilesMetric("files.save.latency_ms", {
            projectId,
            correlationId,
            nodeId,
            value: Math.round(performance.now() - startedAt),
          });
          if (!opts?.silent) showToast("File saved", "success");
          return true;
        } catch (e: unknown) {
          setTabById((prev) => ({
            ...prev,
            [nodeId]: { ...prev[nodeId], isSaving: false },
          }));
          recordFilesMetric("files.save.latency_ms", {
            projectId,
            correlationId,
            nodeId,
            value: Math.round(performance.now() - startedAt),
            extra: { failed: true },
          });
          if (!opts?.silent) {
            showToast(`Failed to save: ${getErrorMessage(e, "Unknown error")}`, "error");
          }
          return false;
        }
      })();

      inFlightSaveByNodeRef.current.set(nodeId, runSave);
      try {
        return await runSave;
      } finally {
        const current = inFlightSaveByNodeRef.current.get(nodeId);
        if (current === runSave) {
          inFlightSaveByNodeRef.current.delete(nodeId);
        }
      }
    },
    [
      canEdit,
      ensureSaveGuards,
      enqueueIndexUpdate,
      getSupabase,
      projectId,
      setTabById,
      showToast,
      storeActions,
      tabByIdRef,
    ]
  );

  const saveContentDirect = useCallback(
    async (
      node: ProjectNode,
      content: string,
      opts?: { silent?: boolean; reason?: string }
    ): Promise<boolean> => {
      if (!canEdit) return false;
      if (!node?.id || !node.s3Key) return false;
      const startedAt = performance.now();
      const correlationId = createFilesCorrelationId("save");

      if (opts?.reason !== "offline-flush") {
        const guard = await ensureSaveGuards(node.id, opts?.reason);
        if (!guard.ok) {
          if (!opts?.silent && guard.error) showToast(guard.error, "error");
          return false;
        }
      }

      try {
        const supabase = getSupabase();
        const blob = new Blob([content], { type: node.mimeType || "text/plain" });
        const { error } = await supabase.storage
          .from("project-files")
          .update(node.s3Key, blob, { upsert: true });
        if (error) throw error;

        const size = UTF8_ENCODER.encode(content).length;
        const updatedNode = (await updateProjectFileStats(projectId, node.id, size)) as ProjectNode;
        storeActions.upsertNodes(projectId, [updatedNode]);

        try {
          const ext = node.name.split(".").pop()?.toLowerCase();
          const isText =
            (node.mimeType || "").startsWith("text/") ||
            ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "sql", "py", "txt"].includes(
              ext || ""
            );
          if (isText) {
            const shouldQueue =
              (filesFeatureFlags.indexAsyncQueue || filesFeatureFlags.wave2AsyncIndexQueue) &&
              content.length >= ASYNC_INDEX_MIN_CHARS;
            if (shouldQueue) {
              enqueueIndexUpdate(node.id, content);
            } else {
              await upsertProjectFileIndex(projectId, node.id, content);
            }
          }
        } catch { }

        const savedAt = Date.now();
        storeActions.setFileState(projectId, node.id, { isDirty: false, lastSavedAt: savedAt });
        // Phase 5: Store saved snapshot in detached Map
        setDetachedContent(projectId, node.id, content);
        setDetachedContent(projectId, `${node.id}::saved`, content);
        setTabById((prev) => {
          if (!prev[node.id]) return prev;
          return {
            ...prev,
            [node.id]: {
              ...prev[node.id],
              node: updatedNode,
              content: "",
              contentVersion: (prev[node.id]?.contentVersion ?? 0) + 1,
              savedSnapshot: "",
              savedSnapshotVersion: (prev[node.id]?.savedSnapshotVersion ?? 0) + 1,
              isDirty: false,
              isSaving: false,
              offlineQueued: false,
              lastSavedAt: savedAt,
            },
          };
        });

        try {
          await recordProjectNodeEvent(
            projectId,
            node.id,
            "save",
            { bytes: size },
            { idempotencyKey: correlationId }
          );
        } catch { }

        recordFilesMetric("files.save.latency_ms", {
          projectId,
          correlationId,
          nodeId: node.id,
          value: Math.round(performance.now() - startedAt),
        });
        if (!opts?.silent) showToast("File saved", "success");
        return true;
      } catch (e: unknown) {
        recordFilesMetric("files.save.latency_ms", {
          projectId,
          correlationId,
          nodeId: node.id,
          value: Math.round(performance.now() - startedAt),
          extra: { failed: true, reason: opts?.reason || "direct" },
        });
        if (!opts?.silent) showToast(`Failed to save: ${getErrorMessage(e, "Unknown error")}`, "error");
        return false;
      }
    },
    [canEdit, ensureSaveGuards, enqueueIndexUpdate, getSupabase, projectId, setTabById, showToast, storeActions]
  );

  const openFileInPane = useCallback(
    async (node: ProjectNode, paneId?: PaneId) => {
      if (!node || node.type !== "file") return;
      const targetPane = paneId ?? activePane;

      setActivePane(targetPane);
      openTab(projectId, targetPane, node.id);
      setSelectedNode(projectId, node.id, node.parentId ?? null);
      setRecentFileIds((prev) => {
        const without = prev.filter((id) => id !== node.id);
        return [node.id, ...without].slice(0, 50);
      });

      const wantsPreview =
        isAssetLike(node) &&
        (viewMode === "assets" || viewMode === "all" || (viewMode === "code" && !isTextLike(node)));

      const existing = tabByIdRef.current[node.id];
      if (!existing) {
        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            id: node.id,
            node,
            content: "",
            contentVersion: 0,
            savedSnapshot: "",
            savedSnapshotVersion: 0,
            isDirty: false,
            isLoading: true,
            isSaving: false,
            isDeleting: false,
            hasLock: false,
            lockInfo: null,
            offlineQueued: false,
            error: null,
            assetUrl: null,
            assetUrlExpiresAt: null,
          },
        }));
      } else {
        setTabById((prev) => ({
          ...prev,
          [node.id]: { ...prev[node.id], node },
        }));
      }

      if (wantsPreview) {
        const now = Date.now();
        const canReuse = existing?.assetUrl && (existing.assetUrlExpiresAt ?? 0) > now + 5_000;
        if (!canReuse) {
          setTabById((prev) => ({
            ...prev,
            [node.id]: { ...prev[node.id], isLoading: true, error: null },
          }));
          try {
            const url = await ensureSignedUrlForNode(node);
            const exp = signedUrlCacheRef.current.get(node.id)?.expiresAt ?? null;
            setTabById((prev) => ({
              ...prev,
              [node.id]: {
                ...prev[node.id],
                node,
                isLoading: false,
                assetUrl: url,
                assetUrlExpiresAt: exp,
              },
            }));
          } catch (e: unknown) {
            setTabById((prev) => ({
              ...prev,
              [node.id]: {
                ...prev[node.id],
                node,
                isLoading: false,
                error: getErrorMessage(e, "Failed to load preview"),
              },
            }));
          }
        }
      } else if (!existing || (!getFileContent(projectId, node.id) && !existing.isDirty)) {
        await loadFileContent(node);
      }

      if (canEdit) {
        await acquireLockForNode(node);
      }
    },
    [
      activePane,
      acquireLockForNode,
      canEdit,
      ensureSignedUrlForNode,
      loadFileContent,
      openTab,
      projectId,
      setActivePane,
      setRecentFileIds,
      setSelectedNode,
      setTabById,
      signedUrlCacheRef,
      tabByIdRef,
      viewMode,
    ]
  );

  const closeTab = useCallback(
    async (paneId: PaneId, nodeId: string) => {
      const tab = tabByIdRef.current[nodeId];
      if (tab?.isDirty && canEdit) {
        const ok = await saveTab(nodeId, { silent: true, reason: "close" });
        if (!ok) {
          showToast("Could not save changes; tab kept open.", "error");
          return;
        }
      }
      if (tab?.hasLock) {
        try {
          await releaseProjectNodeLock(projectId, nodeId);
        } catch { }
        storeActions.clearLock(projectId, nodeId);
      }
      nextLockAttemptAtRef.current.delete(nodeId);
      closeTabStore(projectId, paneId, nodeId);
    },
    [canEdit, closeTabStore, nextLockAttemptAtRef, projectId, saveTab, showToast, storeActions, tabByIdRef]
  );

  const deleteFile = useCallback(
    async (nodeId: string) => {
      if (!canEdit) return;
      const tab = tabByIdRef.current[nodeId];
      if (!tab) return;

      setTabById((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], isDeleting: true },
      }));

      try {
        await trashNode(nodeId, projectId);
        storeActions.removeNodeFromCaches(projectId, nodeId);
        if (tab.hasLock) {
          try {
            await releaseProjectNodeLock(projectId, nodeId);
          } catch { }
          storeActions.clearLock(projectId, nodeId);
        }
        setTabById((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
        nextLockAttemptAtRef.current.delete(nodeId);
        showToast("Moved to Trash", "success");
      } catch (e: unknown) {
        setTabById((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], isDeleting: false },
        }));
        showToast(`Failed to delete file: ${getErrorMessage(e, "Unknown error")}`, "error");
      }
    },
    [canEdit, nextLockAttemptAtRef, projectId, setTabById, showToast, storeActions, tabByIdRef]
  );

  const handleSaveAllDirtyTabs = useCallback(async () => {
    if (!canEdit) return;
    if (dirtyTabIds.length === 0) {
      showToast("No unsaved files", "info");
      return;
    }
    await runWithConcurrency(dirtyTabIds, SAVE_ALL_CONCURRENCY, async (nodeId) => {
      await saveTab(nodeId, { silent: true, reason: "save-all" });
    });
    const remainingDirty = Object.values(tabByIdRef.current).filter((tab) => tab.isDirty).length;
    if (remainingDirty === 0) {
      showToast(`Saved ${dirtyTabIds.length} file(s)`, "success");
    } else {
      showToast(`Saved with ${remainingDirty} file(s) still unsaved`, "info");
    }
  }, [canEdit, dirtyTabIds, saveTab, showToast, tabByIdRef]);

  return {
    conflictDialog,
    setConflictDialog,
    saveTab,
    saveContentDirect,
    openFileInPane,
    closeTab,
    deleteFile,
    handleSaveAllDirtyTabs,
  };
}
