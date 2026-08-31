"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Heart,
  Loader2,
  MessageCircle,
  MessageCircleReply,
  Send,
  Trash2,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type {
  TaskDiscussionComment,
  TaskDiscussionTypingUser,
} from "@/lib/projects/task-discussion";
import { cn } from "@/lib/utils";

import MentionComposer from "../components/MentionComposer";
import CommentBody from "../components/CommentBody";

type CommentMutationResult = { success: boolean; error?: string };
type PresenceStatus = "connecting" | "connected" | "disconnected" | "error";

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
  presenceStatus: PresenceStatus;
  topLevelTypingUsers: TaskDiscussionTypingUser[];
  replyTypingUsersByParentId: Record<string, TaskDiscussionTypingUser[]>;
  onAddComment: (content: string, parentCommentId?: string | null) => Promise<CommentMutationResult>;
  onToggleLike: (commentId: string) => Promise<CommentMutationResult>;
  onDeleteComment: (commentId: string) => Promise<CommentMutationResult>;
  onLoadOlderComments: () => Promise<void>;
  onSendTyping: (params: { isTyping: boolean; parentCommentId?: string | null }) => Promise<void>;
  initialCommentId?: string | null;
}

function displayName(comment: Pick<TaskDiscussionComment, "author">) {
  return comment.author?.fullName || comment.author?.username || "Unknown";
}

function initials(comment: Pick<TaskDiscussionComment, "author">) {
  return displayName(comment).charAt(0).toUpperCase();
}

function timeAgo(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function typingLabel(users: TaskDiscussionTypingUser[], reply = false) {
  if (users.length === 0) return null;
  const names = users.map((user) => user.fullName || user.username || "Someone");
  const subject = names.length > 2
    ? `${names[0]} and ${names.length - 1} others`
    : new Intl.ListFormat("en").format(names);
  return `${subject} ${names.length === 1 ? "is" : "are"} typing${reply ? " a reply" : ""}…`;
}

function ThreadRail({
  children,
  incoming,
  outgoing,
}: {
  children: React.ReactNode;
  incoming: boolean;
  outgoing: boolean;
}) {
  return (
    <div className="relative flex w-8 shrink-0 self-stretch justify-center py-0.5">
      {/*
       * Extend each side of the rail beneath the avatar ring. The overlap makes
       * the parent/reply connection continuous even when either entry grows
       * because of actions, mentions, or a multi-line comment.
       */}
      {incoming ? <span aria-hidden className="absolute -top-3 left-1/2 h-7 w-px -translate-x-1/2 bg-zinc-200 dark:bg-zinc-700" /> : null}
      {outgoing ? <span aria-hidden className="absolute -bottom-3 left-1/2 top-4 w-px -translate-x-1/2 bg-zinc-200 dark:bg-zinc-700" /> : null}
      <div className="relative z-10 h-8 w-8 rounded-full bg-white ring-[3px] ring-white dark:bg-zinc-900 dark:ring-zinc-900">
        {children}
      </div>
    </div>
  );
}

function DiscussionEntry({
  entry,
  replyTo,
  currentUserId,
  canEdit,
  pendingDelete,
  pendingLike,
  highlighted,
  incoming,
  outgoing,
  showReply,
  showThread,
  onDelete,
  onToggleLike,
  onReply,
  onShowThread,
}: {
  entry: TaskDiscussionComment | TaskDiscussionComment["replies"][number];
  replyTo?: string | null;
  currentUserId?: string;
  canEdit: boolean;
  pendingDelete: boolean;
  pendingLike: boolean;
  highlighted: boolean;
  incoming: boolean;
  outgoing: boolean;
  showReply: boolean;
  showThread: boolean;
  onDelete: () => void;
  onToggleLike: () => void;
  onReply: () => void;
  onShowThread: () => void;
}) {
  const deleted = Boolean(entry.deletedAt);
  const name = displayName(entry);

  return (
    <div
      id={`task-comment-${entry.id}`}
      className={cn(
        "relative flex gap-3 rounded-md px-1 py-1.5 transition-colors duration-200",
        highlighted && "bg-primary/10",
      )}
    >
      <ThreadRail incoming={incoming} outgoing={outgoing}>
        <Avatar className="h-8 w-8 border border-zinc-200 dark:border-zinc-700">
          <AvatarImage src={entry.author?.avatarUrl || undefined} alt={name} />
          <AvatarFallback className="bg-zinc-200 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {initials(entry)}
          </AvatarFallback>
        </Avatar>
      </ThreadRail>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] leading-4">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
              <span className="text-[12px] text-zinc-400 dark:text-zinc-500">· {timeAgo(entry.createdAt)}</span>
              {entry.pending ? <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Sending…</span> : null}
            </div>
            {replyTo ? <p className="mt-0.5 text-[12px] leading-4 text-zinc-500">Replying to <span className="font-medium text-primary">@{replyTo}</span></p> : null}
          </div>
          {!deleted && currentUserId === entry.userId ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pendingDelete}
              className="rounded p-1 text-zinc-400 transition-colors hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Delete comment"
            >
              {pendingDelete ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>

        {deleted ? (
          <p className="mt-1 text-sm italic text-zinc-500">This comment was removed.</p>
        ) : (
          <CommentBody content={entry.content} viewerUserId={currentUserId} className="mt-1 text-[14px] leading-5 text-zinc-700 dark:text-zinc-300" />
        )}

        {!deleted ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium leading-4">
            <button
              type="button"
              onClick={onToggleLike}
              disabled={!canEdit || pendingLike}
              className={cn(
                "inline-flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                entry.likedByViewer ? "text-rose-500" : "text-zinc-500 hover:text-rose-500",
              )}
              aria-label={entry.likedByViewer ? "Remove like" : "Like comment"}
            >
              {pendingLike ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className={cn("h-3.5 w-3.5", entry.likedByViewer && "fill-current")} />}
              {entry.likeCount > 0 ? entry.likeCount : "Like"}
            </button>
            {showReply && canEdit ? (
              <button type="button" onClick={onReply} className="inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200">
                <MessageCircleReply className="h-3.5 w-3.5" /> Reply
              </button>
            ) : null}
            {showThread ? (
              <button type="button" onClick={onShowThread} className="text-primary transition-colors hover:underline">
                View conversation
              </button>
            ) : null}
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
  presenceStatus,
  topLevelTypingUsers,
  replyTypingUsersByParentId,
  onAddComment,
  onToggleLike,
  onDeleteComment,
  onLoadOlderComments,
  onSendTyping,
  initialCommentId = null,
}: CommentsTabProps) {
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [activeReplyParentId, setActiveReplyParentId] = useState<string | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Record<string, boolean>>({});
  const [pendingLikeIds, setPendingLikeIds] = useState<Record<string, boolean>>({});
  const [submittingRoot, setSubmittingRoot] = useState(false);
  const [submittingReplyParentId, setSubmittingReplyParentId] = useState<string | null>(null);
  const [rootResetKey, setRootResetKey] = useState(0);
  const [replyResetKey, setReplyResetKey] = useState(0);
  const [showPresenceIssue, setShowPresenceIssue] = useState(false);
  const [, setRelativeTimeTick] = useState(0);
  const rootTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStateRef = useRef(new Map<string, boolean>());
  const initialCommentLoadAttemptsRef = useRef(0);

  useEffect(() => () => {
    if (rootTypingTimerRef.current) clearTimeout(rootTypingTimerRef.current);
    if (replyTypingTimerRef.current) clearTimeout(replyTypingTimerRef.current);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setRelativeTimeTick((tick) => tick + 1);
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (presenceStatus === "connected" || presenceStatus === "connecting") {
      setShowPresenceIssue(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPresenceIssue(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [presenceStatus]);

  useEffect(() => {
    if (!initialCommentId || isLoading) return;
    document.getElementById(`task-comment-${initialCommentId}`)?.scrollIntoView({ block: "center" });
  }, [comments, initialCommentId, isLoading]);

  const initialCommentFound = useMemo(
    () =>
      !initialCommentId ||
      comments.some(
        (comment) =>
          comment.id === initialCommentId ||
          comment.replies.some((reply) => reply.id === initialCommentId),
      ),
    [comments, initialCommentId],
  );

  useEffect(() => {
    initialCommentLoadAttemptsRef.current = 0;
  }, [initialCommentId]);

  useEffect(() => {
    if (
      initialCommentFound ||
      !initialCommentId ||
      !hasMore ||
      isLoading ||
      isLoadingMore ||
      initialCommentLoadAttemptsRef.current >= 20
    ) {
      return;
    }
    initialCommentLoadAttemptsRef.current += 1;
    void onLoadOlderComments();
  }, [
    hasMore,
    initialCommentFound,
    initialCommentId,
    isLoading,
    isLoadingMore,
    onLoadOlderComments,
  ]);

  const focusedThread = useMemo(() => {
    if (!focusedCommentId) return null;
    const root = comments.find((comment) => comment.id === focusedCommentId)
      ?? comments.find((comment) => comment.replies.some((reply) => reply.id === focusedCommentId));
    return root ?? null;
  }, [comments, focusedCommentId]);
  const visibleComments = focusedThread ? [focusedThread] : comments;
  const topLevelTyping = useMemo(() => typingLabel(topLevelTypingUsers), [topLevelTypingUsers]);

  const scheduleTypingStop = useCallback((parentCommentId?: string | null) => {
    const timerRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      typingStateRef.current.set(parentCommentId ?? "root", false);
      void onSendTyping({ isTyping: false, parentCommentId: parentCommentId ?? null });
    }, 1_800);
  }, [onSendTyping]);

  const handleDraftChange = (value: string, parentCommentId?: string | null) => {
    if (parentCommentId) setReplyDraft(value); else setDraft(value);
    setComposerError(null);
    const isTyping = value.trim().length > 0;
    const typingKey = parentCommentId ?? "root";
    if (typingStateRef.current.get(typingKey) !== isTyping) {
      typingStateRef.current.set(typingKey, isTyping);
      void onSendTyping({ isTyping, parentCommentId: parentCommentId ?? null });
    }
    if (!isTyping) {
      const timerRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    scheduleTypingStop(parentCommentId);
  };

  const submit = async (parentCommentId?: string | null) => {
    const value = (parentCommentId ? replyDraft : draft).trim();
    if (!value || !canEdit || submittingRoot || submittingReplyParentId) return;
    if (parentCommentId) setSubmittingReplyParentId(parentCommentId); else setSubmittingRoot(true);
    setComposerError(null);
    try {
      const result = await onAddComment(value, parentCommentId ?? null);
      if (result.success) {
        const timerRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        typingStateRef.current.set(parentCommentId ?? "root", false);
        if (parentCommentId) {
          setReplyDraft("");
          setReplyResetKey((key) => key + 1);
          setActiveReplyParentId(null);
        } else {
          setDraft("");
          setRootResetKey((key) => key + 1);
        }
        void onSendTyping({ isTyping: false, parentCommentId: parentCommentId ?? null });
      } else {
        setComposerError(result.error || "Could not post comment. Please retry.");
      }
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Could not post comment. Please retry.",
      );
    } finally {
      if (parentCommentId) setSubmittingReplyParentId(null); else setSubmittingRoot(false);
    }
  };

  const runPending = useCallback(async (
    type: "delete" | "like",
    id: string,
    action: () => Promise<CommentMutationResult>,
    fallback: string,
  ) => {
    const setPending = type === "delete" ? setPendingDeleteIds : setPendingLikeIds;
    setPending((current) => ({ ...current, [id]: true }));
    try {
      const result = await action();
      if (!result.success) setComposerError(result.error || fallback);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : fallback);
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }, []);

  const closeReply = () => {
    if (activeReplyParentId) {
      typingStateRef.current.set(activeReplyParentId, false);
      void onSendTyping({ isTyping: false, parentCommentId: activeReplyParentId });
    }
    if (replyTypingTimerRef.current) {
      clearTimeout(replyTypingTimerRef.current);
      replyTypingTimerRef.current = null;
    }
    setReplyDraft("");
    setReplyResetKey((key) => key + 1);
    setActiveReplyParentId(null);
  };

  const openReply = (commentId: string) => {
    if (activeReplyParentId === commentId) {
      closeReply();
      return;
    }
    closeReply();
    setComposerError(null);
    setActiveReplyParentId(commentId);
  };

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {focusedThread ? (
        <button type="button" onClick={() => setFocusedCommentId(null)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to all comments
        </button>
      ) : null}

      {error || composerError ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {composerError || error}
        </div>
      ) : null}

      {showPresenceIssue ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">Live typing is reconnecting. Posting comments remains available.</p>
      ) : null}

      {!focusedThread && canEdit ? (
        <div className="border-b border-zinc-100 pb-4 dark:border-zinc-800">
          {topLevelTyping ? <p className="mb-2 text-xs text-zinc-500">{topLevelTyping}</p> : null}
          <div className="flex gap-2">
            <MessageCircle className="mt-3 h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <MentionComposer
                projectId={projectId}
                placeholder="Add to the discussion…"
                disabled={submittingRoot}
                resetKey={rootResetKey}
                editorClassName="min-h-11 rounded-xl px-3 py-2 leading-5"
                onDraftChange={(value) => handleDraftChange(value)}
                onSubmit={() => void submit()}
                aria-label="Add a comment"
              />
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!draft.trim() || submittingRoot}
              className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Post comment"
            >
              {submittingRoot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : null}

      {!focusedThread ? (
        <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
          <span>{totalCount} comment{totalCount === 1 ? "" : "s"}</span>
          {hasMore ? (
            <button type="button" onClick={() => void onLoadOlderComments()} disabled={isLoadingMore} className="font-semibold text-primary hover:underline disabled:opacity-60">
              {isLoadingMore ? "Loading…" : "Load older comments"}
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="h-12 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-12 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ) : visibleComments.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">No discussion yet</p>
          <p className="mt-1 text-sm text-zinc-500">Start the conversation for this task.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleComments.map((comment) => {
            const replies = comment.replies;
            const replyTyping = typingLabel(replyTypingUsersByParentId[comment.id] ?? [], true);
            const replying = activeReplyParentId === comment.id;
            return (
              <div key={comment.id} className="space-y-1">
                <DiscussionEntry
                  entry={comment}
                  currentUserId={currentUserId}
                  canEdit={canEdit}
                  pendingDelete={pendingDeleteIds[comment.id] === true}
                  pendingLike={pendingLikeIds[comment.id] === true}
                  highlighted={focusedCommentId === comment.id || initialCommentId === comment.id}
                  incoming={false}
                  outgoing={replies.length > 0 || replying}
                  showReply
                  showThread={!focusedThread && replies.length > 0}
                  onDelete={() => void runPending("delete", comment.id, () => onDeleteComment(comment.id), "Could not delete comment.")}
                  onToggleLike={() => void runPending("like", comment.id, () => onToggleLike(comment.id), "Could not update the like.")}
                  onReply={() => openReply(comment.id)}
                  onShowThread={() => setFocusedCommentId(comment.id)}
                />

                {replies.map((reply, index) => (
                  <DiscussionEntry
                    key={reply.id}
                    entry={reply}
                    replyTo={displayName(comment)}
                    currentUserId={currentUserId}
                    canEdit={canEdit}
                    pendingDelete={pendingDeleteIds[reply.id] === true}
                    pendingLike={pendingLikeIds[reply.id] === true}
                    highlighted={focusedCommentId === reply.id || initialCommentId === reply.id}
                    incoming
                    outgoing={index < replies.length - 1 || replying}
                    showReply={false}
                    showThread={false}
                    onDelete={() => void runPending("delete", reply.id, () => onDeleteComment(reply.id), "Could not delete reply.")}
                    onToggleLike={() => void runPending("like", reply.id, () => onToggleLike(reply.id), "Could not update the like.")}
                    onReply={() => undefined}
                    onShowThread={() => undefined}
                  />
                ))}

                {comment.repliesHaveMore ? (
                  <p className="pl-11 text-xs text-zinc-500">
                    Showing the latest {replies.length} of {comment.replyCount ?? replies.length} replies.
                  </p>
                ) : null}

                {replyTyping ? <p className="pl-11 text-xs text-zinc-500">{replyTyping}</p> : null}
                {replying ? (
                  <div className="flex gap-2 pl-11 pt-1">
                    <div className="min-w-0 flex-1">
                      <MentionComposer
                        projectId={projectId}
                        placeholder={`Reply to ${displayName(comment)}…`}
                        disabled={submittingReplyParentId === comment.id}
                        autoFocus
                        resetKey={replyResetKey}
                        editorClassName="min-h-11 rounded-xl px-3 py-2 leading-5"
                        onDraftChange={(value) => handleDraftChange(value, comment.id)}
                        onSubmit={() => void submit(comment.id)}
                        aria-label={`Reply to ${displayName(comment)}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void submit(comment.id)}
                      disabled={!replyDraft.trim() || submittingReplyParentId === comment.id}
                      className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Post reply"
                    >
                      {submittingReplyParentId === comment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={closeReply}
                      className="mt-1 h-10 shrink-0 rounded-full px-3 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
