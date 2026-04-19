"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Heart, Loader2, MessageCircleReply, Send, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TaskDiscussionComment, TaskDiscussionTypingUser } from "@/lib/projects/task-discussion";
import { cn } from "@/lib/utils";

import MentionComposer from "../components/MentionComposer";
import CommentBody from "../components/CommentBody";

type CommentMutationResult = { success: boolean; error?: string };

interface CommentsTabProps {
  projectId: string;
  comments: TaskDiscussionComment[];
  totalCount: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  canEdit: boolean;
  currentUserId?: string;
  isPresenceConnected: boolean;
  topLevelTypingUsers: TaskDiscussionTypingUser[];
  replyTypingUsersByParentId: Record<string, TaskDiscussionTypingUser[]>;
  onAddComment: (content: string, parentCommentId?: string | null) => Promise<CommentMutationResult>;
  onToggleLike: (commentId: string) => Promise<CommentMutationResult>;
  onDeleteComment: (commentId: string) => Promise<CommentMutationResult>;
  onLoadOlderComments: () => Promise<void>;
  onSendTyping: (params: { isTyping: boolean; parentCommentId?: string | null }) => Promise<void>;
}

const DEFAULT_VISIBLE_REPLIES = 3;

function getDisplayName(comment: Pick<TaskDiscussionComment, "author">) {
  return comment.author?.fullName || comment.author?.username || "Unknown";
}

function getInitials(comment: Pick<TaskDiscussionComment, "author">) {
  return getDisplayName(comment).charAt(0).toUpperCase();
}

function formatTypingLabel(users: TaskDiscussionTypingUser[], reply = false) {
  if (users.length === 0) return null;
  if (users.length === 1) {
    return `${users[0].fullName || users[0].username || "Someone"} is typing${reply ? " a reply" : ""}…`;
  }
  if (users.length === 2) {
    const first = users[0].fullName || users[0].username || "Someone";
    const second = users[1].fullName || users[1].username || "Someone";
    return `${first} and ${second} are typing${reply ? " replies" : ""}…`;
  }
  const first = users[0].fullName || users[0].username || "Someone";
  return `${first} and ${users.length - 1} others are typing${reply ? " replies" : ""}…`;
}

function ReplyRow({
  reply,
  canEdit,
  currentUserId,
  pendingDelete,
  pendingLike,
  onToggleLike,
  onDelete,
}: {
  reply: TaskDiscussionComment["replies"][number];
  canEdit: boolean;
  currentUserId?: string;
  pendingDelete: boolean;
  pendingLike: boolean;
  onToggleLike: () => void;
  onDelete: () => void;
}) {
  const isDeleted = Boolean(reply.deletedAt);

  return (
    <div className="flex gap-3 rounded-xl border border-zinc-200/70 bg-zinc-50/60 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <Avatar className="h-8 w-8 border border-zinc-200 dark:border-zinc-700">
        <AvatarImage src={reply.author?.avatarUrl || undefined} alt={getDisplayName(reply)} />
        <AvatarFallback className="bg-zinc-200 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {getInitials(reply)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {getDisplayName(reply)}
          </span>
          <span className="text-xs text-zinc-500">
            {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
          </span>
          {reply.pending ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Sending…</span>
          ) : null}
          {!isDeleted && currentUserId === reply.userId ? (
            <button
              onClick={onDelete}
              disabled={pendingDelete}
              className="ml-auto text-zinc-400 transition-colors hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Delete reply"
            >
              {pendingDelete ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>

        <div className="rounded-xl rounded-tl-none bg-white px-3 py-3 text-sm text-zinc-700 shadow-sm dark:bg-zinc-950/40 dark:text-zinc-300">
          {isDeleted ? (
            <span className="italic text-zinc-500">Comment deleted</span>
          ) : (
            <CommentBody content={reply.content} viewerUserId={currentUserId} />
          )}
        </div>

        {!isDeleted ? (
          <div className="mt-2 flex items-center gap-4">
            <button
              onClick={onToggleLike}
              disabled={!canEdit || pendingLike}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                reply.likedByViewer ? "text-rose-500" : "text-zinc-500 hover:text-rose-500",
              )}
            >
              {pendingLike ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={cn("h-4 w-4", reply.likedByViewer && "fill-current")} />}
              {reply.likeCount}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CommentsTab({
  projectId,
  comments,
  totalCount,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  canEdit,
  currentUserId,
  isPresenceConnected,
  topLevelTypingUsers,
  replyTypingUsersByParentId,
  onAddComment,
  onToggleLike,
  onDeleteComment,
  onLoadOlderComments,
  onSendTyping,
}: CommentsTabProps) {
  // The composer is contentEditable — we keep the draft as a plain ref/state
  // string (the same raw format the server persists), not as DOM state.
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [replyDraft, setReplyDraft] = useState("");
  const replyDraftRef = useRef("");
  const [activeReplyParentId, setActiveReplyParentId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [expandedReplyParents, setExpandedReplyParents] = useState<Record<string, boolean>>({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Record<string, boolean>>({});
  const [pendingLikeIds, setPendingLikeIds] = useState<Record<string, boolean>>({});
  const [submittingRoot, setSubmittingRoot] = useState(false);
  const [submittingReplyParentId, setSubmittingReplyParentId] = useState<string | null>(null);
  // Bumping these resets the corresponding MentionComposer (clears its DOM).
  const [rootResetKey, setRootResetKey] = useState(0);
  const [replyResetKey, setReplyResetKey] = useState(0);
  const rootTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (rootTypingTimerRef.current) clearTimeout(rootTypingTimerRef.current);
    if (replyTypingTimerRef.current) clearTimeout(replyTypingTimerRef.current);
  }, []);

  const topLevelTypingLabel = useMemo(
    () => formatTypingLabel(topLevelTypingUsers, false),
    [topLevelTypingUsers],
  );

  const scheduleTypingStop = useCallback((parentCommentId?: string | null) => {
    const targetRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
    if (targetRef.current) {
      clearTimeout(targetRef.current);
    }
    targetRef.current = setTimeout(() => {
      targetRef.current = null;
      void onSendTyping({
        isTyping: false,
        parentCommentId: parentCommentId ?? null,
      });
    }, 1800);
  }, [onSendTyping]);

  const handleRootDraftChange = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    if (composerError) setComposerError(null);
    const hasContent = value.trim().length > 0;
    void onSendTyping({ isTyping: hasContent, parentCommentId: null });
    if (!hasContent) {
      if (rootTypingTimerRef.current) {
        clearTimeout(rootTypingTimerRef.current);
        rootTypingTimerRef.current = null;
      }
      return;
    }
    scheduleTypingStop(null);
  };

  const handleReplyDraftChange = (value: string, parentCommentId: string) => {
    setReplyDraft(value);
    replyDraftRef.current = value;
    if (replyError) setReplyError(null);
    const hasContent = value.trim().length > 0;
    void onSendTyping({ isTyping: hasContent, parentCommentId });
    if (!hasContent) {
      if (replyTypingTimerRef.current) {
        clearTimeout(replyTypingTimerRef.current);
        replyTypingTimerRef.current = null;
      }
      return;
    }
    scheduleTypingStop(parentCommentId);
  };

  const submitRootComment = async () => {
    const trimmed = draftRef.current.trim();
    if (!trimmed || !canEdit || submittingRoot) return;

    setSubmittingRoot(true);
    setComposerError(null);
    const result = await onAddComment(trimmed, null);
    if (result.success) {
      setDraft("");
      draftRef.current = "";
      setRootResetKey((k) => k + 1);
      if (rootTypingTimerRef.current) {
        clearTimeout(rootTypingTimerRef.current);
        rootTypingTimerRef.current = null;
      }
      void onSendTyping({ isTyping: false, parentCommentId: null });
    } else {
      setComposerError(result.error || "Could not post comment. Please retry.");
    }
    setSubmittingRoot(false);
  };

  const submitReply = async (parentCommentId: string) => {
    const trimmed = replyDraftRef.current.trim();
    if (!trimmed || !canEdit || submittingReplyParentId) return;

    setSubmittingReplyParentId(parentCommentId);
    setReplyError(null);
    const result = await onAddComment(trimmed, parentCommentId);
    if (result.success) {
      setReplyDraft("");
      replyDraftRef.current = "";
      setActiveReplyParentId(null);
      setReplyResetKey((k) => k + 1);
      if (replyTypingTimerRef.current) {
        clearTimeout(replyTypingTimerRef.current);
        replyTypingTimerRef.current = null;
      }
      void onSendTyping({ isTyping: false, parentCommentId });
    } else {
      setReplyError(result.error || "Could not post reply. Please retry.");
    }
    setSubmittingReplyParentId(null);
  };

  return (
    <div className="space-y-5 p-6">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {!isPresenceConnected ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          Typing indicators are reconnecting.
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Discussion</h3>
          <p className="text-xs text-zinc-500">
            {totalCount} comment{totalCount === 1 ? "" : "s"}. Type <span className="font-medium">@</span> to mention a teammate. Press <span className="font-medium">Ctrl/Cmd + Enter</span> to post.
          </p>
        </div>

        <div className="space-y-4 px-4 py-4">
          {hasMore ? (
            <div className="flex justify-center">
              <button
                onClick={() => void onLoadOlderComments()}
                disabled={isLoadingMore}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
              >
                {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Load older comments
              </button>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No comments yet.
            </div>
          ) : (
            <div className="space-y-5">
              {comments.map((comment) => {
                const isDeleted = Boolean(comment.deletedAt);
                const visibleReplies = expandedReplyParents[comment.id] || comment.replies.length <= DEFAULT_VISIBLE_REPLIES
                  ? comment.replies
                  : comment.replies.slice(-DEFAULT_VISIBLE_REPLIES);
                const hiddenReplyCount = Math.max(0, comment.replies.length - visibleReplies.length);
                const replyTypingLabel = formatTypingLabel(replyTypingUsersByParentId[comment.id] ?? [], true);

                return (
                  <div key={comment.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                    <div className="flex gap-4">
                      <Avatar className="h-10 w-10 border border-zinc-200 dark:border-zinc-700">
                        <AvatarImage src={comment.author?.avatarUrl || undefined} alt={getDisplayName(comment)} />
                        <AvatarFallback className="bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                          {getInitials(comment)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {getDisplayName(comment)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                          </span>
                          {comment.pending ? (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Sending…</span>
                          ) : null}
                          {!isDeleted && currentUserId === comment.userId ? (
                            <button
                              onClick={async () => {
                                setPendingDeleteIds((current) => ({ ...current, [comment.id]: true }));
                                const result = await onDeleteComment(comment.id);
                                if (!result.success) {
                                  setComposerError(result.error || "Could not delete comment.");
                                }
                                setPendingDeleteIds((current) => {
                                  const next = { ...current };
                                  delete next[comment.id];
                                  return next;
                                });
                              }}
                              disabled={pendingDeleteIds[comment.id] === true}
                              className="ml-auto text-zinc-400 transition-colors hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label="Delete comment"
                            >
                              {pendingDeleteIds[comment.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          ) : null}
                        </div>

                        <div className="rounded-2xl rounded-tl-none bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-300">
                          {isDeleted ? (
                            <span className="italic text-zinc-500">Comment deleted</span>
                          ) : (
                            <CommentBody content={comment.content} viewerUserId={currentUserId} />
                          )}
                        </div>

                        {!isDeleted ? (
                          <div className="mt-3 flex flex-wrap items-center gap-4">
                            <button
                              onClick={async () => {
                                setPendingLikeIds((current) => ({ ...current, [comment.id]: true }));
                                const result = await onToggleLike(comment.id);
                                if (!result.success) {
                                  setComposerError(result.error || "Could not update the reaction.");
                                }
                                setPendingLikeIds((current) => {
                                  const next = { ...current };
                                  delete next[comment.id];
                                  return next;
                                });
                              }}
                              disabled={!canEdit || pendingLikeIds[comment.id] === true}
                              className={cn(
                                "inline-flex items-center gap-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                                comment.likedByViewer ? "text-rose-500" : "text-zinc-500 hover:text-rose-500",
                              )}
                            >
                              {pendingLikeIds[comment.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={cn("h-4 w-4", comment.likedByViewer && "fill-current")} />}
                              {comment.likeCount}
                            </button>

                            {canEdit ? (
                              <button
                                onClick={() => {
                                  setReplyError(null);
                                  setReplyDraft("");
                                  replyDraftRef.current = "";
                                  setReplyResetKey((k) => k + 1);
                                  setActiveReplyParentId((current) => current === comment.id ? null : comment.id);
                                }}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                              >
                                <MessageCircleReply className="h-4 w-4" />
                                Reply
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="mt-4 space-y-3 pl-3 sm:pl-6">
                          {hiddenReplyCount > 0 ? (
                            <button
                              onClick={() =>
                                setExpandedReplyParents((current) => ({
                                  ...current,
                                  [comment.id]: !current[comment.id],
                                }))
                              }
                              className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                            >
                              {expandedReplyParents[comment.id] ? "Show fewer replies" : `Show ${hiddenReplyCount} earlier repl${hiddenReplyCount === 1 ? "y" : "ies"}`}
                            </button>
                          ) : null}

                          {visibleReplies.map((reply) => (
                            <ReplyRow
                              key={reply.id}
                              reply={reply}
                              canEdit={canEdit}
                              currentUserId={currentUserId}
                              pendingDelete={pendingDeleteIds[reply.id] === true}
                              pendingLike={pendingLikeIds[reply.id] === true}
                              onToggleLike={async () => {
                                setPendingLikeIds((current) => ({ ...current, [reply.id]: true }));
                                const result = await onToggleLike(reply.id);
                                if (!result.success) {
                                  setReplyError(result.error || "Could not update the reaction.");
                                }
                                setPendingLikeIds((current) => {
                                  const next = { ...current };
                                  delete next[reply.id];
                                  return next;
                                });
                              }}
                              onDelete={async () => {
                                setPendingDeleteIds((current) => ({ ...current, [reply.id]: true }));
                                const result = await onDeleteComment(reply.id);
                                if (!result.success) {
                                  setReplyError(result.error || "Could not delete reply.");
                                }
                                setPendingDeleteIds((current) => {
                                  const next = { ...current };
                                  delete next[reply.id];
                                  return next;
                                });
                              }}
                            />
                          ))}

                          {replyTypingLabel ? (
                            <p className="text-xs text-zinc-500">{replyTypingLabel}</p>
                          ) : null}

                          {activeReplyParentId === comment.id ? (
                            <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                              <MentionComposer
                                projectId={projectId}
                                placeholder={`Reply to ${getDisplayName(comment)}…`}
                                disabled={submittingReplyParentId === comment.id}
                                autoFocus
                                resetKey={replyResetKey}
                                onDraftChange={(value) => handleReplyDraftChange(value, comment.id)}
                                onSubmit={() => void submitReply(comment.id)}
                                aria-label={`Reply to ${getDisplayName(comment)}`}
                              />
                              {replyError ? <p className="mt-2 text-xs text-rose-500">{replyError}</p> : null}
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  onClick={() => {
                                    setActiveReplyParentId(null);
                                    setReplyDraft("");
                                    replyDraftRef.current = "";
                                    setReplyResetKey((k) => k + 1);
                                    void onSendTyping({ isTyping: false, parentCommentId: comment.id });
                                  }}
                                  className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => void submitReply(comment.id)}
                                  disabled={!replyDraft.trim() || submittingReplyParentId === comment.id}
                                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {submittingReplyParentId === comment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                  Reply
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {canEdit ? (
          <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
            {topLevelTypingLabel ? <p className="mb-2 text-xs text-zinc-500">{topLevelTypingLabel}</p> : null}
            <MentionComposer
              projectId={projectId}
              placeholder="Add to the discussion…"
              disabled={submittingRoot}
              resetKey={rootResetKey}
              onDraftChange={handleRootDraftChange}
              onSubmit={() => void submitRootComment()}
              aria-label="Add a comment"
            />

            {composerError ? <p className="mt-2 text-xs text-rose-500">{composerError}</p> : null}

            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void submitRootComment()}
                disabled={!draft.trim() || submittingRoot}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingRoot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Post comment
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
