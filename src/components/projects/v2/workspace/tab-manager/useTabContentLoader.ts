import { useCallback, useRef } from "react";
import type React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState } from "../../state/filesTabTypes";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { getErrorMessage } from "./types";
import {
  getFileContent,
  setFileContent as setDetachedContent,
} from "@/stores/filesWorkspaceStore";

interface UseTabContentLoaderOptions {
  projectId: string;
  ensureSignedUrlForNode: (node: ProjectNode) => Promise<string | null>;
  opsInProgressRef: React.MutableRefObject<Set<string>>;
  setFileState: (projectId: string, nodeId: string, state: Record<string, unknown>) => void;
  setTabById: React.Dispatch<React.SetStateAction<Record<string, FilesWorkspaceTabState>>>;
}

export function useTabContentLoader({
  projectId,
  ensureSignedUrlForNode,
  opsInProgressRef,
  setFileState,
  setTabById,
}: UseTabContentLoaderOptions) {
  const loadTokenRef = useRef<Map<string, number>>(new Map());
  const contentLoadInFlightRef = useRef(0);
  const inFlightByNodeRef = useRef<Map<string, Promise<void>>>(new Map());

  const loadFileContent = useCallback(
    async (node: ProjectNode) => {
      if (!node?.id || !node.s3Key) return;
      const existingLoad = inFlightByNodeRef.current.get(node.id);
      if (existingLoad) return existingLoad;
      if (opsInProgressRef.current.has(node.id)) return;
      if (
        contentLoadInFlightRef.current >= FILES_RUNTIME_BUDGETS.maxInFlightContentRequests
      ) {
        return;
      }

      const runLoad = (async () => {
        opsInProgressRef.current.add(node.id);
        contentLoadInFlightRef.current += 1;

        const nextToken = (loadTokenRef.current.get(node.id) || 0) + 1;
        loadTokenRef.current.set(node.id, nextToken);

        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...(prev[node.id] ?? {
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
            }),
            node,
            isLoading: true,
            error: null,
          },
        }));

        const ws = useFilesWorkspaceStore.getState().byProjectId[projectId];
        const cached = ws?.fileStates?.[node.id];

        if (cached) {
          // Phase 5: Read content from detached Map instead of Zustand state
          const cachedContent = getFileContent(projectId, node.id);
          const hasContent = cachedContent.length > 0 || cached.isDirty;
          if (hasContent) {
            // Initialize saved snapshot so isNoOpSave works on first save
            setDetachedContent(projectId, `${node.id}::saved`, cachedContent);
            setTabById((prev) => {
              const prevTab = prev[node.id];
              return {
                ...prev,
                [node.id]: {
                  ...prevTab,
                  content: "",
                  contentVersion: (prevTab?.contentVersion ?? 0) + 1,
                  isDirty: cached.isDirty,
                  lastSavedAt: cached.lastSavedAt,
                  savedSnapshot: "",
                  savedSnapshotVersion: (prevTab?.savedSnapshotVersion ?? 0) + 1,
                  isLoading: false,
                },
              };
            });
            return;
          }
        }

        try {
          const url = await ensureSignedUrlForNode(node);
          if (!url) throw new Error("Failed to fetch file URL");
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
          const text = await res.text();
          const latestToken = loadTokenRef.current.get(node.id);
          if (latestToken !== nextToken) return;

          setFileState(projectId, node.id, { content: text, isDirty: false });

          // Phase 5: Store in detached Map + initialize saved snapshot
          setDetachedContent(projectId, node.id, text);
          setDetachedContent(projectId, `${node.id}::saved`, text);
          setTabById((prev) => {
            const prevTab = prev[node.id];
            return {
              ...prev,
              [node.id]: {
                ...prevTab,
                node,
                content: "",
                contentVersion: (prevTab?.contentVersion ?? 0) + 1,
                savedSnapshot: "",
                savedSnapshotVersion: (prevTab?.savedSnapshotVersion ?? 0) + 1,
                isLoading: false,
                isDirty: false,
                error: null,
              },
            };
          });
        } catch (e: unknown) {
          const latestToken = loadTokenRef.current.get(node.id);
          if (latestToken !== nextToken) return;
          setTabById((prev) => ({
            ...prev,
            [node.id]: {
              ...prev[node.id],
              node,
              isLoading: false,
              error: getErrorMessage(e, "Failed to load file content"),
            },
          }));
        } finally {
          opsInProgressRef.current.delete(node.id);
          contentLoadInFlightRef.current = Math.max(0, contentLoadInFlightRef.current - 1);
        }
      })();

      inFlightByNodeRef.current.set(node.id, runLoad);
      try {
        await runLoad;
      } finally {
        const current = inFlightByNodeRef.current.get(node.id);
        if (current === runLoad) {
          inFlightByNodeRef.current.delete(node.id);
        }
      }
    },
    [ensureSignedUrlForNode, opsInProgressRef, projectId, setFileState, setTabById]
  );

  return {
    loadFileContent,
  };
}
