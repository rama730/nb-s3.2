import { useCallback, useRef } from "react";
import type React from "react";
import type { ProjectNode } from "@/lib/db/schema";
import type { FilesWorkspaceTabState } from "../../state/filesTabTypes";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { getErrorMessage } from "./types";

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

  const loadFileContent = useCallback(
    async (node: ProjectNode) => {
      if (!node?.id || !node.s3Key) return;
      if (opsInProgressRef.current.has(node.id)) return;
      if (
        contentLoadInFlightRef.current >= FILES_RUNTIME_BUDGETS.maxInFlightContentRequests
      ) {
        return;
      }

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
            savedSnapshot: "",
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
        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...prev[node.id],
            content: cached.content,
            isDirty: cached.isDirty,
            lastSavedAt: cached.lastSavedAt,
            savedSnapshot: cached.content,
            isLoading: false,
          },
        }));
        if (cached.content !== undefined || cached.isDirty) {
          opsInProgressRef.current.delete(node.id);
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

        setTabById((prev) => ({
          ...prev,
          [node.id]: {
            ...prev[node.id],
            node,
            content: text,
            savedSnapshot: text,
            isLoading: false,
            isDirty: false,
            error: null,
          },
        }));
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
    },
    [ensureSignedUrlForNode, opsInProgressRef, projectId, setFileState, setTabById]
  );

  return {
    loadFileContent,
  };
}
