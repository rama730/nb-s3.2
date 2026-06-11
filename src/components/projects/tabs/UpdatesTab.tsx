"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  FileText,
  Heart,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PanelRightOpen,
  Paperclip,
  Pin,
  Send,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createProjectUpdateAction,
  createProjectUpdateCommentAction,
  deleteProjectUpdateAction,
  deleteProjectUpdateCommentAction,
  editProjectUpdateAction,
  readProjectUpdateAction,
  readProjectUpdateCommentsAction,
  readProjectUpdatesAction,
  toggleProjectUpdateLikeAction,
  toggleProjectUpdatePinAction,
  type ProjectUpdateCommentView,
  type ProjectUpdateMovementSummary,
  type ProjectUpdateView,
} from "@/app/actions/project";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { createClient } from "@/lib/supabase/client";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { queryKeys } from "@/lib/query-keys";
import { PROJECT_UPDATE_VIRTUALIZE_THRESHOLD } from "@/lib/projects/updates";
import { cn } from "@/lib/utils";
import { splitMarkdownByInlineReferences } from "@/lib/projects/readme-blocks";
import { getBreadcrumbs } from "@/app/actions/files/nodes";

function ReferenceLink({
  reference,
  projectId,
  projectSlug,
}: {
  reference: { kind: string; id: string; label: string };
  projectId: string;
  projectSlug?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const slug = projectSlug || projectId;

    if (reference.kind === "tasks") {
      router.push(`/projects/${encodeURIComponent(slug)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(reference.id)}`);
    } else if (reference.kind === "sprints") {
      router.push(`/projects/${encodeURIComponent(slug)}/sprints/${encodeURIComponent(reference.id)}`);
    } else if (reference.kind === "files") {
      setLoading(true);
      try {
        const breadcrumbs = await getBreadcrumbs(projectId, reference.id);
        const pathParts = breadcrumbs.map((b: any) => encodeURIComponent(b.name)).join("/");
        router.push(`/projects/${encodeURIComponent(slug)}?tab=files&path=${pathParts}`);
      } catch (err) {
        console.error("Failed to navigate to file:", err);
        toast.error("Failed to load file location");
      } finally {
        setLoading(false);
      }
    }
  };

  const isClickable = reference.kind === "tasks" || reference.kind === "sprints" || reference.kind === "files";

  if (!isClickable) {
    return (
      <span className="inline-flex items-center gap-1 mx-1 rounded bg-zinc-50 px-1.5 py-0.5 text-sm font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {reference.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-1 mx-1 rounded bg-blue-50 px-1.5 py-0.5 text-sm font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200 transition-all duration-150 hover:bg-blue-100 hover:text-blue-800 dark:hover:bg-blue-900 dark:hover:text-blue-100 cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed border border-transparent hover:border-blue-200 dark:hover:border-blue-800",
        loading && "animate-pulse"
      )}
    >
      {reference.kind === "files" ? (
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
      ) : reference.kind === "tasks" ? (
        <FileText className="h-3.5 w-3.5 shrink-0" />
      ) : reference.kind === "sprints" ? (
        <Timer className="h-3.5 w-3.5 shrink-0" />
      ) : null}
      {reference.label}
    </button>
  );
}

type UpdatesPage = {
  updates: ProjectUpdateView[];
  nextCursor: string | null;
  hasMore: boolean;
  movementSummary?: ProjectUpdateMovementSummary | null;
  capabilities?: {
    canCreate: boolean;
    canManage: boolean;
    canInteract: boolean;
  };
};

type UpdatesTabProps = {
  projectId: string;
  projectSlug?: string | null;
  projectName: string;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  canCreateUpdates: boolean;
  canManageUpdates: boolean;
  initialUpdateId?: string | null;
  initialCommentId?: string | null;
  initialUpdatesPage?: UpdatesPage | null;
};

import { ProjectUpdateComposer } from "../updates/ProjectUpdateComposer";

function relativeTime(date: string) {
  const value = new Date(date);
  const time = value.getTime();
  if (!Number.isFinite(time)) return "";

  const now = new Date();
  const delta = now.getTime() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < minute) return "Just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfValue = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  if (startOfToday - startOfValue === day) return "Yesterday";
  if (delta < 7 * day) return `${Math.floor(delta / day)}d`;

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function updateShortcutTime(date: string) {
  const value = new Date(date);
  const time = value.getTime();
  if (!Number.isFinite(time)) return "";

  const delta = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < minute) return "Just now";
  if (delta < hour) {
    const minutes = Math.max(1, Math.floor(delta / minute));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (delta < day) {
    const hours = Math.max(1, Math.floor(delta / hour));
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (delta < 7 * day) {
    const days = Math.max(1, Math.floor(delta / day));
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function updateAuthorName(update: ProjectUpdateView) {
  return update.author?.fullName || update.author?.username || "Former member";
}

function updateAuthorRoleLabel(update: ProjectUpdateView) {
  return (
    update.author?.roleLabel ??
    update.author?.roleTitle ??
    update.author?.membershipRoleLabel ??
    null
  );
}

type ProjectUpdateContextItem = NonNullable<ProjectUpdateView["context"]["references"]>[number];

function formatUpdateFileSize(bytes: number | null | undefined) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function updateContextItems(update: ProjectUpdateView): ProjectUpdateContextItem[] {
  const orderedReferences = update.context.references ?? [];
  if (orderedReferences.length > 0) return orderedReferences;
  return [
    update.context.task ?? null,
    update.context.sprint ?? null,
    update.context.file ?? null,
  ].filter((item): item is ProjectUpdateContextItem => Boolean(item));
}

function UpdateContextIcon({ kind }: { kind: ProjectUpdateContextItem["kind"] }) {
  if (kind === "task") return <FileText className="h-4 w-4" />;
  if (kind === "sprint") return <Timer className="h-4 w-4" />;
  return <Paperclip className="h-4 w-4" />;
}

function UpdateContextAndMedia({ update }: { update: ProjectUpdateView }) {
  const contextItems = updateContextItems(update);
  const mediaItems = update.media.filter((item) => item.url || item.label);

  if (contextItems.length === 0 && mediaItems.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {contextItems.map((item) => (
        <a
          key={`${item.kind}:${item.id}`}
          href={item.href ?? "#"}
          className="group flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2 transition hover:border-blue-200 hover:bg-blue-50/50 dark:border-zinc-800 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/20"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:group-hover:bg-blue-950/50">
            <UpdateContextIcon kind={item.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {item.label}
            </span>
            {item.description ? (
              <span className="block truncate text-xs text-zinc-500">
                {item.description}
              </span>
            ) : null}
          </span>
          {item.href ? (
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition group-hover:text-blue-500" />
          ) : null}
        </a>
      ))}

      {mediaItems.map((item, index) =>
        item.type === "image" && item.url ? (
          <a
            key={`${item.url}-${index}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-2xl border border-zinc-200 transition hover:border-blue-200 dark:border-zinc-800 dark:hover:border-blue-900/60"
          >
            <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-900">
              <img
                src={item.url}
                alt={item.altText || item.label || "Project update image"}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
            {item.label || item.size || item.width || item.height ? (
              <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {[
                    item.label,
                    formatUpdateFileSize(item.size),
                    item.width && item.height ? `${item.width}×${item.height}` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
            ) : null}
          </a>
        ) : (
          <a
            key={`${item.url ?? item.label}-${index}`}
            href={item.url ?? "#"}
            target={item.url ? "_blank" : undefined}
            rel={item.url ? "noreferrer" : undefined}
            className="group flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2 transition hover:border-blue-200 hover:bg-blue-50/50 dark:border-zinc-800 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/20"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition group-hover:bg-blue-50 group-hover:text-blue-600 dark:bg-zinc-900 dark:text-zinc-300 dark:group-hover:bg-blue-950/30 dark:group-hover:text-blue-300">
              {item.type === "file" ? <Paperclip className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {item.label || item.url || "Linked item"}
              </span>
              {item.url ? (
                <span className="block truncate text-xs text-zinc-500">
                  {item.url}
                </span>
              ) : null}
            </span>
            {item.url ? (
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition group-hover:text-blue-500" />
            ) : null}
          </a>
        ),
      )}
    </div>
  );
}

function realtimeStringField(record: unknown, key: string) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function useDesktopUpdatesRail() {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return matches;
}

function prependUpdate(
  existing: InfiniteData<UpdatesPage> | undefined,
  update: ProjectUpdateView,
): InfiniteData<UpdatesPage> {
  if (!existing)
    return {
      pages: [{ updates: [update], nextCursor: null, hasMore: false }],
      pageParams: [null],
    };
  const [first, ...rest] = existing.pages;
  if (!first) {
    return {
      ...existing,
      pages: [{ updates: [update], nextCursor: null, hasMore: false }],
    };
  }
  return {
    ...existing,
    pages: [{ ...first, nextCursor: first.nextCursor ?? null, hasMore: first.hasMore ?? false, updates: [update, ...first.updates] }, ...rest],
  };
}

function replaceUpdate(
  existing: InfiniteData<UpdatesPage> | undefined,
  oldId: string,
  next: ProjectUpdateView,
): InfiniteData<UpdatesPage> {
  if (!existing) return existing!;
  return {
    ...existing,
    pages: existing.pages.map((page) => ({
      ...page,
      updates: page.updates.map((u) => (u.id === oldId ? next : u)),
    })),
  };
}

function updatePages(
  existing: InfiniteData<UpdatesPage> | undefined,
  transform: (item: ProjectUpdateView) => ProjectUpdateView,
): InfiniteData<UpdatesPage> {
  if (!existing) return existing!;
  return {
    ...existing,
    pages: existing.pages.map((page) => ({
      ...page,
      updates: page.updates.map(transform),
    })),
  };
}


function CommentRow({
  comment,
  replies,
  highlightedCommentId,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  onReply,
  onDelete,
}: {
  comment: ProjectUpdateCommentView;
  replies?: ProjectUpdateCommentView[];
  highlightedCommentId?: string | null;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  onReply: (parentId: string, content: string) => void;
  onDelete: (commentId: string) => void;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");

  const handleReplySubmit = () => {
    const val = replyDraft.trim();
    if (!val) return;
    onReply(comment.id, val);
    setReplyDraft("");
    setIsReplying(false);
  };

  const renderComment = (c: ProjectUpdateCommentView, isReply = false) => (
    <div
      key={c.id}
      id={`project-update-comment-${c.id}`}
      className={cn(
        "flex gap-2 rounded-lg transition-colors",
        highlightedCommentId === c.id && "bg-blue-50/70 dark:bg-blue-950/20",
        isReply ? "mt-3" : ""
      )}
    >
      {c.author?.username ? (
        <Link href={`/u/${c.author.username}`} prefetch={false} className="shrink-0 transition-opacity hover:opacity-80">
          <UserAvatar
            identity={{
              fullName: c.author.fullName ?? c.author.username ?? "Member",
              username: c.author.username,
              avatarUrl: c.author.avatarUrl ?? null,
            }}
            size={isReply ? 28 : 32}
            className="mt-1"
          />
        </Link>
      ) : (
        <UserAvatar
          identity={{
            fullName: c.author?.fullName ?? c.author?.username ?? "Member",
            username: c.author?.username ?? null,
            avatarUrl: c.author?.avatarUrl ?? null,
          }}
          size={isReply ? 28 : 32}
          className="mt-1"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-zinc-50 px-3 py-2 dark:bg-zinc-900/70">
          {c.deletedAt ? (
            <p className="text-sm italic text-zinc-400">This comment was removed.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {c.author?.username ? (
                      <Link href={`/u/${c.author.username}`} prefetch={false} className="hover:underline">
                        {c.author.fullName || c.author.username}
                      </Link>
                    ) : (
                      c.author?.fullName || c.author?.username || "Former member"
                    )}
                    <span className="ml-2 text-xs font-normal text-zinc-400">
                      {relativeTime(c.createdAt)}
                    </span>
                  </p>
                  {c.author?.roleLabel ? (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {c.author.roleLabel}
                    </p>
                  ) : null}
                </div>
                {c.canDelete ? (
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="text-zinc-400 hover:text-red-500"
                    aria-label="Delete comment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
                {c.content}
              </p>
            </>
          )}
        </div>
        {!isReply && !c.deletedAt && currentUserId && (
          <div className="mt-1 ml-2 flex items-center gap-4 text-xs font-medium text-zinc-500">
            <button
              type="button"
              onClick={() => setIsReplying(!isReplying)}
              className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors"
            >
              Reply
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 pb-3">
      {renderComment(comment, false)}

      {(replies && replies.length > 0) || isReplying ? (
        <div className="ml-10 space-y-3 border-l-2 border-zinc-100 pl-4 dark:border-zinc-800">
          {replies?.map((reply) => renderComment(reply, true))}
          
          {isReplying && (
            <div className="flex gap-2 mt-2">
              <UserAvatar
                identity={{
                  fullName: currentUserName ?? "You",
                  avatarUrl: currentUserAvatarUrl ?? null,
                }}
                size={28}
                className="mt-1 shrink-0"
              />
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 dark:border-zinc-800 dark:bg-zinc-900/60">
                <input
                  autoFocus
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value.slice(0, 1000))}
                  placeholder={`Reply to ${comment.author?.fullName || comment.author?.username || "comment"}...`}
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleReplySubmit();
                    } else if (e.key === "Escape") {
                      setIsReplying(false);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!replyDraft.trim()}
                  onClick={handleReplySubmit}
                  className="rounded-full p-1 text-blue-500 transition hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-950/30"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function UpdateComments({
  projectId,
  update,
  updatesQueryKey,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  highlightedCommentId,
}: {
  projectId: string;
  update: ProjectUpdateView;
  updatesQueryKey: readonly unknown[];
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  highlightedCommentId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const commentsKey = useMemo(
    () => queryKeys.project.detail.updateComments(projectId, update.id),
    [projectId, update.id],
  );
  const comments = useInfiniteQuery({
    queryKey: commentsKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await readProjectUpdateCommentsAction(
        projectId,
        update.id,
        pageParam,
      );
      if (!result.success)
        throw new Error(result.error || "Failed to load comments");
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: update.commentCount > 0 || Boolean(currentUserId),
    staleTime: 15_000,
  });

  const commentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string | null }) => {
      const result = await createProjectUpdateCommentAction(
        projectId,
        update.id,
        content,
        parentId,
      );
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to post comment");
      return result.data;
    },
    onMutate: async ({ content, parentId }) => {
      const tempId = `temp-comment-${Date.now()}`;
      const optimistic: ProjectUpdateCommentView = {
        id: tempId,
        updateId: update.id,
        projectId,
        parentId: parentId || null,
        userId: currentUserId,
        author: {
          id: currentUserId,
          fullName: currentUserName ?? null,
          username: null,
          avatarUrl: currentUserAvatarUrl ?? null,
          roleLabel: null,
          roleTitle: null,
          membershipRoleLabel: null,
          roleSource: null,
        },
        content,
        canDelete: true,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await queryClient.cancelQueries({ queryKey: commentsKey });
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previousComments =
        queryClient.getQueryData<
          InfiniteData<{
            comments: ProjectUpdateCommentView[];
            nextCursor: string | null;
            hasMore: boolean;
          }>
        >(commentsKey);
      const previousUpdates =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      queryClient.setQueryData(
        commentsKey,
        (
          existing:
            | InfiniteData<{
                comments: ProjectUpdateCommentView[];
                nextCursor: string | null;
                hasMore: boolean;
              }>
            | undefined,
        ) => {
          if (!existing)
            return {
              pages: [
                { comments: [optimistic], nextCursor: null, hasMore: false },
              ],
              pageParams: [null],
            };
          const [first, ...rest] = existing.pages;
          return first
            ? {
                ...existing,
                pages: [
                  { ...first, comments: [...first.comments, optimistic] },
                  ...rest,
                ],
              }
            : existing;
        },
      );
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? { ...item, commentCount: item.commentCount + 1 }
              : item,
          ),
      );
      return { tempId, previousComments, previousUpdates };
    },
    onError: (error, _content, context) => {
      if (context?.previousComments)
        queryClient.setQueryData(commentsKey, context.previousComments);
      if (context?.previousUpdates)
        queryClient.setQueryData(updatesQueryKey, context.previousUpdates);
      toast.error(
        error instanceof Error ? error.message : "Failed to post comment",
      );
    },
    onSuccess: (comment, _content, context) => {
      queryClient.setQueryData(
        commentsKey,
        (
          existing:
            | InfiniteData<{
                comments: ProjectUpdateCommentView[];
                nextCursor: string | null;
                hasMore: boolean;
              }>
            | undefined,
        ) => {
          if (!existing) return existing;
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              comments: page.comments.map((item) =>
                item.id === context?.tempId ? comment : item,
              ),
            })),
          };
        },
      );
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const result = await deleteProjectUpdateCommentAction(
        projectId,
        commentId,
      );
      if (!result.success)
        throw new Error(result.error || "Failed to delete comment");
      return commentId;
    },
    onSuccess: (commentId) => {
      queryClient.setQueryData(
        commentsKey,
        (
          existing:
            | InfiniteData<{
                comments: ProjectUpdateCommentView[];
                nextCursor: string | null;
                hasMore: boolean;
              }>
            | undefined,
        ) => {
          if (!existing) return existing;
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              comments: page.comments.map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      content: "",
                      deletedAt: new Date().toISOString(),
                      canDelete: false,
                    }
                  : comment,
              ),
            })),
          };
        },
      );
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? { ...item, commentCount: Math.max(0, item.commentCount - 1) }
              : item,
          ),
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to delete comment",
      ),
  });

  const allComments =
    comments.data?.pages.flatMap((page) => page.comments) ?? [];

  const topLevelComments = useMemo(() => allComments.filter((c) => !c.parentId), [allComments]);
  const repliesByParentId = useMemo(() => {
    return allComments.reduce((acc, c) => {
      if (c.parentId) {
        const list = acc[c.parentId];
        if (list) {
          list.push(c);
        } else {
          acc[c.parentId] = [c];
        }
      }
      return acc;
    }, {} as Record<string, ProjectUpdateCommentView[]>);
  }, [allComments]);

  useEffect(() => {
    if (!update.id) return;
    const supabase = createClient();
    const channel = subscribeActiveResource({
      supabase,
      resourceType: "project_hydration",
      resourceId: `update-comments:${update.id}`,
      bindings: [
        {
          event: "*",
          table: "project_update_comments",
          filter: `update_id=eq.${update.id}`,
          handler: (payload) => {
            const nextUserId =
              realtimeStringField(payload.new, "user_id") ??
              realtimeStringField(payload.old, "user_id");
            if (nextUserId && nextUserId === currentUserId) return;
            void queryClient.invalidateQueries({ queryKey: commentsKey });
            void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
          },
        },
      ],
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [commentsKey, currentUserId, queryClient, update.id, updatesQueryKey]);

  useEffect(() => {
    if (!highlightedCommentId) return;
    if (!allComments.some((comment) => comment.id === highlightedCommentId))
      return;
    requestAnimationFrame(() => {
      document
        .getElementById(`project-update-comment-${highlightedCommentId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [allComments, highlightedCommentId]);

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900 flex flex-col min-h-0">
      {currentUserId && update.canComment ? (
        <div className="flex gap-2 mb-3 shrink-0">
          <UserAvatar
            identity={{
              fullName: currentUserName ?? "You",
              avatarUrl: currentUserAvatarUrl ?? null,
            }}
            size={32}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900/60">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 1_000))}
              placeholder="Write a comment"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const value = draft.trim();
                  if (!value) return;
                  setDraft("");
                  commentMutation.mutate({ content: value, parentId: null });
                }
              }}
            />
            <button
              type="button"
              disabled={!draft.trim() || commentMutation.isPending}
              onClick={() => {
                const value = draft.trim();
                if (!value) return;
                setDraft("");
                commentMutation.mutate({ content: value, parentId: null });
              }}
              className="rounded-full p-1.5 text-blue-500 transition hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-950/30"
              aria-label="Post comment"
            >
              {commentMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      ) : null}
      
      {comments.isLoading ? (
        <div className="h-10 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900 shrink-0" />
      ) : topLevelComments.length > 0 ? (
        <div className="space-y-3">
          {topLevelComments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              replies={repliesByParentId[comment.id]}
              highlightedCommentId={highlightedCommentId}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              onReply={(parentId, content) => commentMutation.mutate({ content, parentId })}
              onDelete={(commentId) => deleteCommentMutation.mutate(commentId)}
            />
          ))}
          {comments.hasNextPage ? (
            <div className="pb-4 pt-1">
              <button
                type="button"
                onClick={() => comments.fetchNextPage()}
                className="text-sm font-semibold text-blue-500 hover:underline"
              >
                Load more comments
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UpdateCard({
  projectId,
  projectSlug,
  update,
  updatesQueryKey,
  onHide,
  onOpenDetail,
  currentUserId,
  highlighted,
}: {
  projectId: string;
  projectSlug?: string | null;
  update: ProjectUpdateView;
  updatesQueryKey: readonly unknown[];
  onHide: (updateId: string) => void;
  onOpenDetail: (updateId: string) => void;
  currentUserId: string | null;
  highlighted: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(update.content);
  const href = `/projects/${encodeURIComponent(projectSlug || projectId)}?tab=updates&updateId=${encodeURIComponent(update.id)}`;
  const isDeleted = Boolean(update.deletedAt);
  const canSaveEdit = Boolean(
    draft.trim() || updateContextItems(update).length > 0 || update.media.length > 0,
  );

  const likeMutation = useMutation({
    mutationFn: async () => {
      const result = await toggleProjectUpdateLikeAction(projectId, update.id);
      if (!result.success)
        throw new Error(result.error || "Failed to update like");
      return result;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? {
                  ...item,
                  likedByViewer: !item.likedByViewer,
                  likeCount: item.likedByViewer
                    ? Math.max(0, item.likeCount - 1)
                    : item.likeCount + 1,
                }
              : item,
          ),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(updatesQueryKey, context.previous);
      toast.error(
        error instanceof Error ? error.message : "Failed to update like",
      );
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? {
                  ...item,
                  likedByViewer: result.liked,
                  likeCount: result.likeCount,
                }
              : item,
          ),
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const result = await editProjectUpdateAction(projectId, update.id, {
        content: draft,
        entityRefs: update.entityRefs,
        media: update.media,
      });
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to edit update");
      return result.data;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id ? next : item,
          ),
      );
      setIsEditing(false);
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Update edited");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to edit update",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const result = await deleteProjectUpdateAction(projectId, update.id);
      if (!result.success)
        throw new Error(result.error || "Failed to delete update");
      return result.data ?? null;
    },
    onSuccess: (deletedUpdate) => {
      const deletedAt = new Date().toISOString();
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? (deletedUpdate ?? {
                  ...item,
                  content: "",
                  entityRefs: {},
                  context: {},
                  media: [],
                  metadata: {},
                  isPinned: false,
                  canEdit: false,
                  canDelete: false,
                  canPin: false,
                  canComment: false,
                  deletedAt,
                  updatedAt: deletedAt,
                })
              : item,
          ),
      );
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Update removed");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to delete update",
      ),
  });

  const pinMutation = useMutation({
    mutationFn: async () => {
      const result = await toggleProjectUpdatePinAction(
        projectId,
        update.id,
        !update.isPinned,
      );
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to update pin");
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to update pin",
      ),
  });

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      id={`project-update-${update.id}`}
      className={cn(
        "border-b border-zinc-200 px-1 py-5 transition-colors dark:border-zinc-800",
        highlighted && "bg-blue-50/70 dark:bg-blue-950/20",
      )}
    >
      {update.isPinned ? (
        <div className="mb-2 ml-14 flex items-center gap-1 text-xs font-semibold text-zinc-500">
          <Pin className="h-3.5 w-3.5" />
          Pinned update
        </div>
      ) : null}
      <div className="flex gap-3">
        {update.author?.username ? (
          <Link href={`/u/${update.author.username}`} prefetch={false} className="shrink-0 transition-opacity hover:opacity-80">
            <UserAvatar
              identity={{
                fullName: updateAuthorName(update),
                username: update.author?.username ?? null,
                avatarUrl: update.author?.avatarUrl ?? null,
              }}
              size={44}
              className="mt-1"
            />
          </Link>
        ) : (
          <UserAvatar
            identity={{
              fullName: updateAuthorName(update),
              username: update.author?.username ?? null,
              avatarUrl: update.author?.avatarUrl ?? null,
            }}
            size={44}
            className="mt-1"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {update.author?.username ? (
                  <Link href={`/u/${update.author.username}`} prefetch={false} className="truncate font-semibold text-zinc-950 hover:underline dark:text-zinc-50">
                    {updateAuthorName(update)}
                  </Link>
                ) : (
                  <span className="truncate font-semibold text-zinc-950 dark:text-zinc-50">
                    {updateAuthorName(update)}
                  </span>
                )}
                {update.author?.roleLabel ? (
                  <span className="text-sm text-zinc-500">
                    {update.author.roleLabel}
                  </span>
                ) : null}
                <span className="text-sm text-zinc-400">
                  · {relativeTime(update.createdAt)}
                </span>
                {!isDeleted && update.editedAt ? (
                  <span className="text-xs text-zinc-400">Edited</span>
                ) : null}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                  aria-label="Update options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onOpenDetail(update.id)}>
                  <PanelRightOpen className="h-4 w-4" />
                  Open detail
                </DropdownMenuItem>
                {!isDeleted ? (
                  <DropdownMenuItem onClick={() => onHide(update.id)}>
                    <Trash2 className="h-4 w-4" />
                    Hide update
                  </DropdownMenuItem>
                ) : null}
                {update.canPin ? (
                  <DropdownMenuItem onClick={() => pinMutation.mutate()}>
                    <Pin className="h-4 w-4" />
                    {update.isPinned ? "Unpin update" : "Pin update"}
                  </DropdownMenuItem>
                ) : null}
                {update.canEdit ? (
                  <DropdownMenuItem onClick={() => setIsEditing(true)}>
                    <FileText className="h-4 w-4" />
                    Edit update
                  </DropdownMenuItem>
                ) : null}
                {update.canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm("Remove this project update?"))
                          deleteMutation.mutate();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete update
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {isDeleted ? (
            <p className="mt-3 text-[15px] italic leading-6 text-zinc-400">
              This update was removed.
            </p>
          ) : isEditing ? (
            <div className="mt-3">
              <Textarea
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value.slice(0, 2_000))
                }
                className="min-h-28 resize-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(update.content);
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!canSaveEdit || editMutation.isPending}
                  onClick={() => editMutation.mutate()}
                >
                  {editMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          ) : update.content.trim() ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenDetail(update.id)}
              onMouseEnter={() => router.prefetch(href)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDetail(update.id);
                }
              }}
              className="mt-3 block w-full cursor-pointer whitespace-pre-wrap break-words text-left text-[15px] leading-6 text-zinc-800 transition hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50 outline-none"
            >
              {splitMarkdownByInlineReferences(update.content).map((segment, i) => {
                  if (segment.kind === "markdown") return <span key={i}>{segment.content}</span>;
                  return (
                      <ReferenceLink
                          key={i}
                          reference={segment.reference}
                          projectId={projectId}
                          projectSlug={projectSlug}
                      />
                  );
              })}
            </div>
          ) : null}

          {!isDeleted ? (
            <UpdateContextAndMedia update={update} />
          ) : null}

          {!isDeleted ? (
            <div className="mt-3 flex items-center gap-8 text-sm text-zinc-500">
              <button
                type="button"
                onClick={() =>
                  currentUserId
                    ? likeMutation.mutate()
                    : toast.error("Please log in to like updates")
                }
                className={cn(
                  "inline-flex items-center gap-2 rounded-full transition hover:text-rose-500",
                  update.likedByViewer && "text-rose-500",
                )}
              >
                <Heart
                  className={cn(
                    "h-4 w-4",
                    update.likedByViewer && "fill-current",
                  )}
                />
                {update.likeCount}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!currentUserId) {
                    toast.error("Please log in to comment");
                    return;
                  }
                  onOpenDetail(update.id);
                }}
                className="inline-flex items-center gap-2 rounded-full transition hover:text-blue-500"
              >
                <MessageCircle className="h-4 w-4" />
                {update.commentCount}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}

const MemoizedUpdateCard = memo(UpdateCard);
MemoizedUpdateCard.displayName = "MemoizedProjectUpdateCard";

function UpdatesRightRail({
  updates,
  onOpenDetail,
}: {
  updates: ProjectUpdateView[];
  onOpenDetail: (updateId: string) => void;
}) {
  const postingMembers = useMemo(
    () => {
      const latestByAuthor = new Map<string, ProjectUpdateView>();
      updates
        .filter((update) => !update.deletedAt)
        .forEach((update) => {
          const key =
            update.author?.id ??
            update.author?.username ??
            update.authorId ??
            update.id;
          const current = latestByAuthor.get(key);
          if (
            !current ||
            new Date(update.createdAt).getTime() > new Date(current.createdAt).getTime()
          ) {
            latestByAuthor.set(key, update);
          }
        });

      return Array.from(latestByAuthor.values()).sort((a, b) => {
        const createdDelta =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return createdDelta || b.id.localeCompare(a.id);
      });
    },
    [updates],
  );

  return (
    <section aria-label="Update shortcuts" className="space-y-5">
      <div className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
          Updates
        </h3>
      </div>

      {postingMembers.length ? (
        <div className="divide-y divide-zinc-200 border-b border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {postingMembers.map((update) => {
            const roleLabel = updateAuthorRoleLabel(update);
            const authorName = updateAuthorName(update);
            return (
              <button
                key={update.id}
                type="button"
                onClick={() => onOpenDetail(update.id)}
                className="group flex w-full min-w-0 items-center gap-3 py-3 text-left"
              >
                <UserAvatar
                  identity={{
                    fullName: authorName,
                    username: update.author?.username ?? null,
                    avatarUrl: update.author?.avatarUrl ?? null,
                  }}
                  size={32}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-500 transition-colors group-hover:text-zinc-950 dark:text-zinc-400 dark:group-hover:text-zinc-50">
                  <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                    {authorName}
                  </span>
                  {roleLabel ? <span> · {roleLabel}</span> : null}
                  <span> · {updateShortcutTime(update.createdAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="border-b border-zinc-200 py-8 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            No updates yet
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Project members will appear here after their first post.
          </p>
        </div>
      )}
    </section>
  );
}

function UpdateDetailPanel({
  projectId,
  projectSlug,
  update,
  updatesQueryKey,
  onClose,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  highlightedCommentId,
  className,
}: {
  projectId: string;
  projectSlug?: string | null;
  update: ProjectUpdateView | null;
  updatesQueryKey: readonly unknown[];
  onClose: () => void;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  highlightedCommentId?: string | null;
  className?: string;
}) {
  useEffect(() => {
    if (!update) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, update]);

  if (!update) return null;
  const isDeleted = Boolean(update.deletedAt);

  return (
    <section className={cn("w-full min-w-0 bg-transparent", className)}>
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Update detail
          </p>
          <p className="text-xs text-zinc-500">
            {relativeTime(update.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          aria-label="Close detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="py-5 pr-1">
        <article className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
          <div className="flex gap-3">
            {update.author?.username ? (
              <Link href={`/u/${update.author.username}`} prefetch={false} className="shrink-0 transition-opacity hover:opacity-80">
                <UserAvatar
                  identity={{
                    fullName: updateAuthorName(update),
                    username: update.author?.username ?? null,
                    avatarUrl: update.author?.avatarUrl ?? null,
                  }}
                  size={44}
                  className="mt-0.5"
                />
              </Link>
            ) : (
              <UserAvatar
                identity={{
                  fullName: updateAuthorName(update),
                  username: update.author?.username ?? null,
                  avatarUrl: update.author?.avatarUrl ?? null,
                }}
                size={44}
                className="mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {update.author?.username ? (
                  <Link href={`/u/${update.author.username}`} prefetch={false} className="truncate text-base font-semibold text-zinc-950 hover:underline dark:text-zinc-50">
                    {updateAuthorName(update)}
                  </Link>
                ) : (
                  <span className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    {updateAuthorName(update)}
                  </span>
                )}
                {update.author?.roleLabel ? (
                  <span className="text-sm text-zinc-500">
                    {update.author.roleLabel}
                  </span>
                ) : null}
              </div>

              {isDeleted ? (
                <p className="mt-3 text-[15px] italic leading-6 text-zinc-400">
                  This update was removed.
                </p>
              ) : update.content.trim() ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-800 dark:text-zinc-200">
                  {splitMarkdownByInlineReferences(update.content).map((segment, i) => {
                      if (segment.kind === "markdown") return <span key={i}>{segment.content}</span>;
                      return (
                          <ReferenceLink
                              key={i}
                              reference={segment.reference}
                              projectId={projectId}
                              projectSlug={projectSlug}
                          />
                      );
                  })}
                </p>
              ) : null}

              {!isDeleted ? (
                <UpdateContextAndMedia update={update} />
              ) : null}

              {!isDeleted ? (
                <div className="mt-4 flex items-center gap-8 text-sm text-zinc-500">
                  <span className="inline-flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    {update.likeCount}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    {update.commentCount}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </article>

        {!isDeleted ? (
          <UpdateComments
            projectId={projectId}
            update={update}
            updatesQueryKey={updatesQueryKey}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserAvatarUrl={currentUserAvatarUrl}
            highlightedCommentId={highlightedCommentId}
          />
        ) : null}
      </div>
    </section>
  );
}

export default function UpdatesTab({
  projectId,
  projectSlug,
  projectName,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  canCreateUpdates,
  canManageUpdates,
  initialUpdateId,
  initialCommentId,
  initialUpdatesPage = null,
}: UpdatesTabProps) {
  const queryClient = useQueryClient();
  const updatesQueryKey = queryKeys.project.detail.updates(projectId);
  const [hiddenUpdateIds, setHiddenUpdateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailUpdateId, setDetailUpdateId] = useState<string | null>(
    initialUpdateId ?? null,
  );
  const isDesktopUpdatesRail = useDesktopUpdatesRail();
  const mobileDetailRef = useRef<HTMLDivElement | null>(null);
  const [feedScrollParent, setFeedScrollParent] = useState<HTMLElement | null>(null);

  const updatesQuery = useInfiniteQuery({
    queryKey: updatesQueryKey,
    initialPageParam: null as string | null,
    initialData: initialUpdatesPage
      ? { pages: [initialUpdatesPage], pageParams: [null] }
      : undefined,
    queryFn: async ({ pageParam }) => {
      const result = await readProjectUpdatesAction(projectId, {
        cursor: pageParam,
      });
      if (!result.success)
        throw new Error(result.error || "Failed to load project updates");
      return result.data as UpdatesPage;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 20_000,
  });

  const updates = useMemo(
    () => updatesQuery.data?.pages.flatMap((page) => page.updates) ?? [],
    [updatesQuery.data],
  );
  const visibleUpdates = useMemo(
    () => updates.filter((update) => !hiddenUpdateIds.has(update.id)),
    [hiddenUpdateIds, updates],
  );
  const shouldVirtualizeFeed =
    visibleUpdates.length > PROJECT_UPDATE_VIRTUALIZE_THRESHOLD;
  const detailUpdate = useMemo(
    () =>
      detailUpdateId
        ? (updates.find((update) => update.id === detailUpdateId) ?? null)
        : null,
    [detailUpdateId, updates],
  );
  const hideUpdate = useCallback((updateId: string) => {
    setHiddenUpdateIds((current) => new Set(current).add(updateId));
    toast.success("Update hidden");
  }, []);
  const openDetail = useCallback((updateId: string) => {
    setDetailUpdateId(updateId);
    requestAnimationFrame(() => {
      mobileDetailRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);
  const capabilities = updatesQuery.data?.pages[0]?.capabilities;
  const canCreate = Boolean(capabilities?.canCreate ?? canCreateUpdates);
  const canManage = Boolean(capabilities?.canManage ?? canManageUpdates);

  useEffect(() => {
    const routeScrollRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
    setFeedScrollParent(routeScrollRoot ?? null);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const handleProjectUpdateChange = (payload: { new?: unknown; old?: unknown }) => {
      const authorId =
        realtimeStringField(payload.new, "author_id") ??
        realtimeStringField(payload.old, "author_id");
      if (authorId && authorId === currentUserId) return;
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
    };
    const channel = subscribeActiveResource({
      supabase,
      resourceType: "project_hydration",
      resourceId: `updates:${projectId}`,
      bindings: [
        {
          event: "INSERT",
          table: "project_updates",
          filter: `project_id=eq.${projectId}`,
          handler: handleProjectUpdateChange,
        },
        {
          event: "UPDATE",
          table: "project_updates",
          filter: `project_id=eq.${projectId}`,
          handler: handleProjectUpdateChange,
        },
        {
          event: "DELETE",
          table: "project_updates",
          filter: `project_id=eq.${projectId}`,
          handler: handleProjectUpdateChange,
        },
      ],
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, projectId, queryClient, updatesQueryKey]);

  useEffect(() => {
    if (!initialUpdateId) return;
    setDetailUpdateId(initialUpdateId);
    const hasUpdate = updates.some((update) => update.id === initialUpdateId);
    if (hasUpdate) {
      requestAnimationFrame(() => {
        document
          .getElementById(`project-update-${initialUpdateId}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    let cancelled = false;
    readProjectUpdateAction(projectId, initialUpdateId).then((result) => {
      if (cancelled || !result.success || !result.data) return;
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          prependUpdate(existing, result.data!),
      );
      requestAnimationFrame(() => {
        document
          .getElementById(`project-update-${initialUpdateId}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [initialUpdateId, projectId, queryClient, updates, updatesQueryKey]);

  const createMutation = useMutation({
    mutationFn: async (
      input: Parameters<typeof createProjectUpdateAction>[1],
    ) => {
      const result = await createProjectUpdateAction(projectId, input);
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to post update");
      return result.data;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      const tempId = `temp-update-${Date.now()}`;
      const optimistic: ProjectUpdateView = {
        id: tempId,
        projectId,
        authorId: currentUserId,
        author: {
          id: currentUserId,
          fullName: currentUserName ?? null,
          username: null,
          avatarUrl: currentUserAvatarUrl ?? null,
          roleLabel: null,
          roleTitle: null,
          membershipRoleLabel: null,
          roleSource: null,
        },
        content: input.content,
        updateType: null,
        visibility: input.visibility === "members" ? "members" : "public",
        replyPolicy: "logged_in",
        entityRefs: input.entityRefs ?? {},
        context: {},
        media: input.media ?? [],
        metadata: {},
        isPinned: false,
        likeCount: 0,
        commentCount: 0,
        likedByViewer: false,
        canEdit: true,
        canDelete: true,
        canPin: canManage,
        canComment: Boolean(currentUserId),
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          prependUpdate(existing, optimistic),
      );
      return { previous, tempId };
    },
    onError: (error, _input, context) => {
      if (context?.previous)
        queryClient.setQueryData(updatesQueryKey, context.previous);
      toast.error(
        error instanceof Error ? error.message : "Failed to post update",
      );
    },
    onSuccess: (update, _input, context) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          context?.tempId
            ? replaceUpdate(existing, context.tempId, update)
            : prependUpdate(existing, update),
      );
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Project update posted");
    },
  });

  const feed = updatesQuery.isLoading ? (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-1 py-5">
          <div className="h-11 w-11 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  ) : visibleUpdates.length === 0 ? (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-950/30">
        <MessageCircle className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-950 dark:text-zinc-50">
        No updates yet
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">
        {canCreate
          ? "Share the first progress post so followers can see what is moving."
          : "Follow this project to get notified when the team shares progress."}
      </p>
    </div>
  ) : shouldVirtualizeFeed ? (
    <Virtuoso
      {...(feedScrollParent ? { customScrollParent: feedScrollParent } : { useWindowScroll: true })}
      data={visibleUpdates}
      itemContent={(_, update) => (
        <MemoizedUpdateCard
          projectId={projectId}
          projectSlug={projectSlug}
          update={update}
          updatesQueryKey={updatesQueryKey}
          onHide={hideUpdate}
          onOpenDetail={openDetail}
          currentUserId={currentUserId}
          highlighted={initialUpdateId === update.id}
        />
      )}
    />
  ) : (
    <div>
      <AnimatePresence initial={false}>
        {visibleUpdates.map((update) => (
          <MemoizedUpdateCard
            key={update.id}
            projectId={projectId}
            projectSlug={projectSlug}
            update={update}
            updatesQueryKey={updatesQueryKey}
            onHide={hideUpdate}
            onOpenDetail={openDetail}
            currentUserId={currentUserId}
            highlighted={initialUpdateId === update.id}
          />
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <div
      className={cn(
        "grid w-full max-w-none gap-8 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,820px)_minmax(0,1fr)]"
      )}
    >
      <main className="min-w-0">
        <div className="px-1 pb-3 pt-2">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Updates
            </h2>
            <p className="text-sm text-zinc-500">
              Progress posts for followers and project visitors.
            </p>
          </div>
        </div>

        {isDesktopUpdatesRail === false ? (
          <ProjectUpdateComposer
            projectId={projectId}
            projectName={projectName}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserAvatarUrl={currentUserAvatarUrl}
            canCreate={canCreate}
            canManage={canManage}
            isPosting={createMutation.isPending}
            onPost={(input) => createMutation.mutate(input)}
          />
        ) : null}

        {detailUpdate ? (
          <div ref={mobileDetailRef} className="xl:hidden">
            <UpdateDetailPanel
              projectId={projectId}
              projectSlug={projectSlug}
              update={detailUpdate}
              updatesQueryKey={updatesQueryKey}
              onClose={() => setDetailUpdateId(null)}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              highlightedCommentId={
                detailUpdate.id === initialUpdateId ? initialCommentId : null
              }
              className="mb-4 animate-in fade-in slide-in-from-bottom-2 border-y border-zinc-200 py-4 duration-200 dark:border-zinc-800"
            />
          </div>
        ) : null}

        {feed}

        {updatesQuery.hasNextPage ? (
          <div className="px-1 py-4">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full"
              onClick={() => updatesQuery.fetchNextPage()}
              disabled={updatesQuery.isFetchingNextPage}
            >
              {updatesQuery.isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Load more updates
            </Button>
          </div>
        ) : null}
      </main>

      <aside className="hidden w-full min-w-0 self-stretch xl:block">
        <div
          className="sticky top-4 min-h-[calc(100dvh-10rem)] max-h-[calc(100dvh-2rem)] w-full overflow-y-auto border-l border-zinc-200 pl-7 pr-4 dark:border-zinc-800"
        >
          {detailUpdate ? (
            <UpdateDetailPanel
              projectId={projectId}
              projectSlug={projectSlug}
              update={detailUpdate}
              updatesQueryKey={updatesQueryKey}
              onClose={() => setDetailUpdateId(null)}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              highlightedCommentId={
                detailUpdate.id === initialUpdateId ? initialCommentId : null
              }
              className="animate-in fade-in slide-in-from-right-2 duration-200"
            />
          ) : (
            <div className="space-y-6">
              {isDesktopUpdatesRail === true ? (
                <ProjectUpdateComposer
                  projectId={projectId}
                  projectName={projectName}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  currentUserAvatarUrl={currentUserAvatarUrl}
                  canCreate={canCreate}
                  canManage={canManage}
                  isPosting={createMutation.isPending}
                  onPost={(input) => createMutation.mutate(input)}
                />
              ) : null}
              <UpdatesRightRail
                updates={visibleUpdates}
                onOpenDetail={openDetail}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
