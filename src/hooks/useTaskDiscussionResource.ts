"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createTaskCommentAction,
  deleteTaskCommentAction,
  readTaskDiscussionAction,
  readTaskDiscussionCommentAction,
  toggleTaskCommentLikeAction,
} from "@/app/actions/task-comment";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { useAuth } from "@/lib/hooks/use-auth";
import {
  appendTaskDiscussionEntry,
  buildOptimisticTaskDiscussionEntry,
  countTaskDiscussionEntries,
  createEmptyTaskDiscussionPage,
  mergeTaskDiscussionPage,
  patchTaskDiscussionEntry,
  patchTaskDiscussionLike,
  reconcileTaskDiscussionInsert,
  removeTaskDiscussionEntry,
  replaceOptimisticTaskDiscussionEntry,
  tombstoneTaskDiscussionEntry,
  type TaskDiscussionAuthor,
  type TaskDiscussionBaseEntry,
  type TaskDiscussionComment,
  type TaskDiscussionCursor,
  type TaskDiscussionThreadPage,
} from "@/lib/projects/task-discussion";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

import { useTaskDiscussionTyping } from "./useTaskDiscussionTyping";

type CreateCommentResult = { success: true } | { success: false; error: string };

export function useTaskDiscussionResource(params: {
  taskId: string;
  projectId: string;
  canEdit: boolean;
  currentUserId?: string;
  enabled: boolean;
}) {
  const { taskId, projectId, canEdit, currentUserId, enabled } = params;
  const { isConnected } = useRealtime();
  const { profile, user } = useAuth();

  const [page, setPage] = useState<TaskDiscussionThreadPage>(() => createEmptyTaskDiscussionPage());
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const resourceConnectedRef = useRef(false);
  const isLoadedRef = useRef(false);

  const currentAuthor = useMemo<TaskDiscussionAuthor | null>(() => (
    currentUserId
      ? {
          id: currentUserId,
          fullName: profile?.fullName ?? (user?.user_metadata?.full_name as string | undefined) ?? null,
          username: profile?.username ?? (user?.user_metadata?.username as string | undefined) ?? null,
          avatarUrl: profile?.avatarUrl ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null,
        }
      : null
  ), [currentUserId, profile?.avatarUrl, profile?.fullName, profile?.username, user?.user_metadata]);

  const typing = useTaskDiscussionTyping(taskId, enabled);

  useEffect(() => {
    setPage(createEmptyTaskDiscussionPage());
    setIsLoading(false);
    setIsLoadingMore(false);
    setError(null);
    setIsLoaded(false);
    resourceConnectedRef.current = false;
  }, [taskId]);

  useEffect(() => {
    isLoadedRef.current = isLoaded;
  }, [isLoaded]);

  const loadDiscussion = useCallback(async (options?: {
    cursor?: TaskDiscussionCursor | null;
    append?: boolean;
  }) => {
    const append = options?.append === true;
    if (!taskId || !projectId) return createEmptyTaskDiscussionPage();

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const result = await readTaskDiscussionAction(projectId, taskId, options?.cursor ?? null);
      if (!result.success) {
        throw new Error(result.error || "Failed to load discussion");
      }

      let nextPage = createEmptyTaskDiscussionPage();
      setPage((current) => {
        nextPage = append
          ? mergeTaskDiscussionPage(current, result.data, "prepend_older")
          : mergeTaskDiscussionPage(createEmptyTaskDiscussionPage(), result.data, "replace");
        return nextPage;
      });
      setIsLoaded(true);
      return nextPage;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load discussion";
      setError(message);
      return createEmptyTaskDiscussionPage();
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [projectId, taskId]);

  const refreshDiscussion = useCallback(async () => loadDiscussion(), [loadDiscussion]);

  const loadOlderComments = useCallback(async () => {
    if (!page.nextCursor || isLoadingMore) return;
    await loadDiscussion({
      cursor: page.nextCursor,
      append: true,
    });
  }, [isLoadingMore, loadDiscussion, page.nextCursor]);

  const loadCommentById = useCallback(async (commentId: string) => {
    if (!commentId) return null;
    const result = await readTaskDiscussionCommentAction(projectId, taskId, commentId);
    if (!result.success) return null;
    return result.data;
  }, [projectId, taskId]);

  useEffect(() => {
    if (!enabled) {
      setIsLoaded(false);
      return;
    }
    if (isLoadedRef.current) return;
    void loadDiscussion();
  }, [enabled, loadDiscussion]);

  useEffect(() => {
    if (!enabled || !taskId) {
      resourceConnectedRef.current = false;
      return;
    }

    const unsubscribe = subscribeTaskResource({
      taskId,
      onEvent: (event) => {
        if (!isLoadedRef.current) return;

        if (event.kind === "comment") {
          const eventType = event.payload.eventType;
          const nextPayload = event.payload.new as Record<string, unknown> | null;
          const previousPayload = event.payload.old as Record<string, unknown> | null;
          const nextCommentId = typeof nextPayload?.id === "string" ? nextPayload.id : null;
          const previousCommentId = typeof previousPayload?.id === "string" ? previousPayload.id : null;
          const parentCommentId =
            typeof nextPayload?.parent_comment_id === "string"
              ? nextPayload.parent_comment_id
              : typeof previousPayload?.parent_comment_id === "string"
                ? previousPayload.parent_comment_id
                : null;

          if ((eventType === "INSERT" || eventType === "UPDATE") && nextCommentId) {
            const isTombstone = Boolean(nextPayload?.deleted_at);
            if (isTombstone) {
              setPage((current) =>
                tombstoneTaskDiscussionEntry(current, {
                  commentId: nextCommentId,
                  deletedAt:
                    typeof nextPayload?.deleted_at === "string"
                      ? nextPayload.deleted_at
                      : new Date().toISOString(),
                  deletedBy:
                    typeof nextPayload?.deleted_by === "string"
                      ? nextPayload.deleted_by
                      : null,
                }),
              );
              return;
            }

            void loadCommentById(nextCommentId).then((entry) => {
              if (!entry) return;
              setPage((current) => (
                eventType === "INSERT"
                  ? reconcileTaskDiscussionInsert(current, entry)
                  : patchTaskDiscussionEntry(current, entry)
              ));
            });
            return;
          }

          if (eventType === "DELETE" && previousCommentId) {
            setPage((current) =>
              removeTaskDiscussionEntry(current, {
                commentId: previousCommentId,
                parentCommentId,
              }),
            );
          }
          return;
        }

        if (event.kind === "comment_like") {
          const nextPayload = event.payload.new as Record<string, unknown> | null;
          const previousPayload = event.payload.old as Record<string, unknown> | null;
          const commentId =
            typeof nextPayload?.comment_id === "string"
              ? nextPayload.comment_id
              : typeof previousPayload?.comment_id === "string"
                ? previousPayload.comment_id
                : "";
          const userId =
            typeof nextPayload?.user_id === "string"
              ? nextPayload.user_id
              : typeof previousPayload?.user_id === "string"
                ? previousPayload.user_id
                : "";

          if (!commentId || !userId) return;

          if (event.payload.eventType === "INSERT" || event.payload.eventType === "DELETE") {
            setPage((current) =>
              patchTaskDiscussionLike(current, {
                commentId,
                userId,
                shouldAdd: event.payload.eventType === "INSERT",
                currentUserId,
              }),
            );
          }
        }
      },
      onStatus: (status) => {
        resourceConnectedRef.current = status === "SUBSCRIBED";
      },
    });

    return () => {
      resourceConnectedRef.current = false;
      unsubscribe();
    };
  }, [currentUserId, enabled, loadCommentById, taskId]);

  useEffect(() => {
    if (!enabled) return;

    const cleanup = createVisibilityAwareInterval(() => {
      if (isConnected && resourceConnectedRef.current) {
        return;
      }

      if (!isLoadedRef.current) {
        void loadDiscussion();
        return;
      }

      void refreshDiscussion();
    }, 30_000);

    return () => {
      cleanup();
    };
  }, [enabled, isConnected, loadDiscussion, refreshDiscussion]);

  const addComment = useCallback(async (content: string, parentCommentId?: string | null): Promise<CreateCommentResult> => {
    if (!canEdit) {
      return { success: false, error: "Forbidden" };
    }
    const trimmed = content.trim();
    if (!trimmed) {
      const message = "Comment cannot be empty";
      setError(message);
      return { success: false, error: message };
    }
    if (!currentUserId) {
      return { success: false, error: "Unauthorized" };
    }

    setError(null);
    const optimisticId = `optimistic:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const optimisticEntry = buildOptimisticTaskDiscussionEntry({
      id: optimisticId,
      taskId,
      userId: currentUserId,
      content: trimmed,
      parentCommentId,
      author: currentAuthor,
    });

    setPage((current) => appendTaskDiscussionEntry(current, optimisticEntry));

    const result = await createTaskCommentAction(taskId, projectId, trimmed, parentCommentId ?? null);
    if (!result.success || !result.data.comment) {
      setPage((current) =>
        removeTaskDiscussionEntry(current, {
          commentId: optimisticId,
          parentCommentId: parentCommentId ?? null,
        }),
      );
      const message = result.error || "Failed to post comment";
      setError(message);
      return { success: false, error: message };
    }

    const createdComment = result.data.comment;
    if (!createdComment) {
      setPage((current) =>
        removeTaskDiscussionEntry(current, {
          commentId: optimisticId,
          parentCommentId: parentCommentId ?? null,
        }),
      );
      return { success: false, error: "Failed to post comment" };
    }

    setPage((current) => replaceOptimisticTaskDiscussionEntry(current, optimisticId, createdComment));
    return { success: true };
  }, [canEdit, currentAuthor, currentUserId, projectId, taskId]);

  const toggleLike = useCallback(async (commentId: string) => {
    if (!canEdit) {
      return { success: false as const, error: "Forbidden" };
    }
    if (!currentUserId) {
      return { success: false as const, error: "Unauthorized" };
    }

    const previous = page;
    const target = page.comments.find((comment) => comment.id === commentId)
      ?? page.comments.flatMap((comment) => comment.replies).find((reply) => reply.id === commentId)
      ?? null;

    if (!target) {
      return { success: false as const, error: "Comment not found" };
    }

    setError(null);
    setPage((current) =>
      patchTaskDiscussionLike(current, {
        commentId,
        userId: currentUserId,
        shouldAdd: !target.likedByViewer,
        currentUserId,
      }),
    );

    const result = await toggleTaskCommentLikeAction(commentId, projectId);
    if (!result.success) {
      setPage(previous);
      const message = result.error || "Failed to update like";
      setError(message);
      return { success: false as const, error: message };
    }

    return { success: true as const };
  }, [canEdit, currentUserId, page, projectId]);

  const deleteComment = useCallback(async (commentId: string) => {
    if (!canEdit) {
      return { success: false as const, error: "Forbidden" };
    }
    const previous = page;
    const target = page.comments.find((comment) => comment.id === commentId)
      ?? page.comments.flatMap((comment) => comment.replies).find((reply) => reply.id === commentId)
      ?? null;

    if (!target) {
      return { success: false as const, error: "Comment not found" };
    }

    setError(null);

    const parentComment = target.parentCommentId
      ? page.comments.find((comment) => comment.id === target.parentCommentId) ?? null
      : page.comments.find((comment) => comment.id === target.id) ?? null;
    const shouldTombstone = Boolean(!target.parentCommentId && parentComment && parentComment.replies.length > 0);

    setPage((current) => (
      shouldTombstone
        ? tombstoneTaskDiscussionEntry(current, {
            commentId,
            deletedAt: new Date().toISOString(),
            deletedBy: currentUserId ?? null,
          })
        : removeTaskDiscussionEntry(current, {
            commentId,
            parentCommentId: target.parentCommentId,
          })
    ));

    const result = await deleteTaskCommentAction(commentId, projectId);
    if (!result.success) {
      setPage(previous);
      const message = result.error || "Failed to delete comment";
      setError(message);
      return { success: false as const, error: message };
    }

    if (result.data.mode === "tombstone") {
      const tombstoneEntry = result.data.entry;
      if (tombstoneEntry) {
        setPage((current) => patchTaskDiscussionEntry(current, tombstoneEntry));
      }
    }

    return { success: true as const };
  }, [canEdit, currentUserId, page, projectId]);

  const comments = page.comments;
  const totalCount = page.totalCount || countTaskDiscussionEntries(page);

  return {
    comments,
    totalCount,
    nextCursor: page.nextCursor,
    isLoading,
    isLoadingMore,
    isLoaded,
    error,
    isPresenceConnected: typing.presenceStatus === "connected",
    topLevelTypingUsers: typing.topLevelTypingUsers,
    replyTypingUsersByParentId: typing.replyTypingUsersByParentId,
    sendTyping: typing.sendTyping,
    loadDiscussion: refreshDiscussion,
    loadOlderComments,
    addComment,
    toggleLike,
    deleteComment,
  };
}
