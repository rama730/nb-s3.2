"use server";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import {
  commentMentions,
  profiles,
  projectMembers,
  projects,
  taskCommentLikes,
  taskComments,
  tasks,
} from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import {
  createEmptyTaskDiscussionPage,
  type TaskDiscussionAuthor,
  type TaskDiscussionBaseEntry,
  type TaskDiscussionCursor,
  type TaskDiscussionDeleteMode,
  type TaskDiscussionThreadPage,
} from "@/lib/projects/task-discussion";
import { parseMentions } from "@/lib/projects/mention-tokens";
import { emitTaskCommentReplyNotification } from "@/lib/notifications/emitters";
import { enqueueTaskCommentMentionNotifications } from "@/lib/notifications/task-comment-mention";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getViewerProfileContext } from "@/lib/server/viewer-context";
import { logger } from "@/lib/logger";

const DISCUSSION_PAGE_SIZE = 20;

type DiscussionRow = {
  id: string;
  taskId: string;
  userId: string;
  parentCommentId: string | null;
  content: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
  deletedBy: string | null;
  authorId: string | null;
  authorFullName: string | null;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
};

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeTaskDiscussionAuthor(row: DiscussionRow): TaskDiscussionAuthor | null {
  if (!row.authorId) return null;
  return {
    id: row.authorId,
    fullName: row.authorFullName,
    username: row.authorUsername,
    avatarUrl: row.authorAvatarUrl,
  };
}

function normalizeTaskDiscussionEntry(params: {
  row: DiscussionRow;
  likeCounts: Map<string, number>;
  likedIds: Set<string>;
}): TaskDiscussionBaseEntry {
  return {
    id: params.row.id,
    taskId: params.row.taskId,
    userId: params.row.userId,
    parentCommentId: params.row.parentCommentId,
    content: params.row.content,
    createdAt: toIsoString(params.row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(params.row.updatedAt) ?? new Date().toISOString(),
    deletedAt: toIsoString(params.row.deletedAt),
    deletedBy: params.row.deletedBy,
    author: normalizeTaskDiscussionAuthor(params.row),
    likeCount: params.likeCounts.get(params.row.id) ?? 0,
    likedByViewer: params.likedIds.has(params.row.id),
  };
}

async function assertTaskAccess(params: {
  taskId: string;
  projectId: string;
  userId: string;
  mode: "read" | "write";
}) {
  const [taskRow] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, params.taskId))
    .limit(1);

  if (!taskRow) {
    throw new Error("Task not found");
  }
  if (taskRow.projectId !== params.projectId) {
    throw new Error("Task does not belong to this project");
  }

  const access = await getProjectAccessById(params.projectId, params.userId);
  if (!access.project) {
    throw new Error("Project not found");
  }
  if (params.mode === "read" && !access.canRead) {
    throw new Error("Forbidden");
  }
  if (params.mode === "write" && !access.canWrite) {
    throw new Error("Forbidden");
  }

  return taskRow;
}

async function assertCommentAccess(params: {
  commentId: string;
  projectId: string;
  userId: string;
  mode: "read" | "write";
}) {
  const [commentRow] = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      projectId: tasks.projectId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      deletedAt: taskComments.deletedAt,
    })
    .from(taskComments)
    .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
    .where(eq(taskComments.id, params.commentId))
    .limit(1);

  if (!commentRow) {
    throw new Error("Comment not found");
  }
  if (commentRow.projectId !== params.projectId) {
    throw new Error("Comment does not belong to this project");
  }

  await assertTaskAccess({
    taskId: commentRow.taskId,
    projectId: params.projectId,
    userId: params.userId,
    mode: params.mode,
  });

  return commentRow;
}

async function readDiscussionRows(params: {
  taskId: string;
  cursor?: TaskDiscussionCursor | null;
  limit?: number;
}) {
  const pageSize = Math.max(1, Math.min(100, params.limit ?? DISCUSSION_PAGE_SIZE));
  const cursorDate = params.cursor?.beforeCreatedAt ? new Date(params.cursor.beforeCreatedAt) : null;
  const hasCursor = Boolean(cursorDate && !Number.isNaN(cursorDate.getTime()) && params.cursor?.beforeId);

  const whereClause = and(
    eq(taskComments.taskId, params.taskId),
    isNull(taskComments.parentCommentId),
    hasCursor
      ? or(
          lt(taskComments.createdAt, cursorDate as Date),
          and(eq(taskComments.createdAt, cursorDate as Date), lt(taskComments.id, params.cursor!.beforeId)),
        )
      : undefined,
  );

  const topLevelRows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      deletedAt: taskComments.deletedAt,
      deletedBy: taskComments.deletedBy,
      authorId: profiles.id,
      authorFullName: profiles.fullName,
      authorUsername: profiles.username,
      authorAvatarUrl: profiles.avatarUrl,
    })
    .from(taskComments)
    .leftJoin(profiles, eq(taskComments.userId, profiles.id))
    .where(whereClause)
    .orderBy(desc(taskComments.createdAt), desc(taskComments.id))
    .limit(pageSize + 1);

  const hasMore = topLevelRows.length > pageSize;
  const limitedTopLevelRows = hasMore ? topLevelRows.slice(0, pageSize) : topLevelRows;
  const oldestLoaded = limitedTopLevelRows[limitedTopLevelRows.length - 1] ?? null;
  const orderedTopLevelRows = [...limitedTopLevelRows].reverse() as DiscussionRow[];
  const parentIds = orderedTopLevelRows.map((row) => row.id);

  const replyRows = parentIds.length > 0
    ? await db
        .select({
          id: taskComments.id,
          taskId: taskComments.taskId,
          userId: taskComments.userId,
          parentCommentId: taskComments.parentCommentId,
          content: taskComments.content,
          createdAt: taskComments.createdAt,
          updatedAt: taskComments.updatedAt,
          deletedAt: taskComments.deletedAt,
          deletedBy: taskComments.deletedBy,
          authorId: profiles.id,
          authorFullName: profiles.fullName,
          authorUsername: profiles.username,
          authorAvatarUrl: profiles.avatarUrl,
        })
        .from(taskComments)
        .leftJoin(profiles, eq(taskComments.userId, profiles.id))
        .where(
          and(
            eq(taskComments.taskId, params.taskId),
            inArray(taskComments.parentCommentId, parentIds),
          ),
        )
        .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
    : [];

  const allCommentIds = [...parentIds, ...replyRows.map((row) => row.id)];
  const likeCounts = new Map<string, number>();
  const nextCursor = hasMore && oldestLoaded
    ? {
        beforeCreatedAt: toIsoString(oldestLoaded.createdAt) ?? new Date().toISOString(),
        beforeId: oldestLoaded.id,
      }
    : null;

  return {
    orderedTopLevelRows,
    replyRows: replyRows as DiscussionRow[],
    allCommentIds,
    likeCounts,
    nextCursor,
  };
}

async function readDiscussionLikeMaps(commentIds: string[], viewerId: string) {
  const likeCounts = new Map<string, number>();
  const likedIds = new Set<string>();

  if (commentIds.length === 0) {
    return { likeCounts, likedIds };
  }

  const likeCountRows = await db
    .select({
      commentId: taskCommentLikes.commentId,
      likeCount: sql<number>`count(*)::int`,
    })
    .from(taskCommentLikes)
    .where(inArray(taskCommentLikes.commentId, commentIds))
    .groupBy(taskCommentLikes.commentId);

  for (const row of likeCountRows) {
    likeCounts.set(row.commentId, Number(row.likeCount ?? 0));
  }

  const viewerLikeRows = await db
    .select({ commentId: taskCommentLikes.commentId })
    .from(taskCommentLikes)
    .where(
      and(
        inArray(taskCommentLikes.commentId, commentIds),
        eq(taskCommentLikes.userId, viewerId),
      ),
    );

  for (const row of viewerLikeRows) {
    likedIds.add(row.commentId);
  }

  return { likeCounts, likedIds };
}

async function readDiscussionCount(taskId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId));

  return Number(row?.count ?? 0);
}

async function readTaskDiscussionInternal(params: {
  projectId: string;
  taskId: string;
  viewerId: string;
  cursor?: TaskDiscussionCursor | null;
  limit?: number;
}): Promise<TaskDiscussionThreadPage> {
  await assertTaskAccess({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.viewerId,
    mode: "read",
  });

  const { orderedTopLevelRows, replyRows, allCommentIds, nextCursor } = await readDiscussionRows({
    taskId: params.taskId,
    cursor: params.cursor,
    limit: params.limit,
  });
  const { likeCounts, likedIds } = await readDiscussionLikeMaps(allCommentIds, params.viewerId);
  const totalCount = await readDiscussionCount(params.taskId);

  const repliesByParentId = new Map<string, TaskDiscussionBaseEntry[]>();
  for (const row of replyRows) {
    const reply = normalizeTaskDiscussionEntry({ row, likeCounts, likedIds });
    const parentId = row.parentCommentId;
    if (!parentId) continue;
    const existing = repliesByParentId.get(parentId) ?? [];
    existing.push(reply);
    repliesByParentId.set(parentId, existing);
  }

  return {
    comments: orderedTopLevelRows.map((row) => ({
      ...normalizeTaskDiscussionEntry({ row, likeCounts, likedIds }),
      replies: repliesByParentId.get(row.id) ?? [],
    })),
    nextCursor,
    totalCount,
  };
}

async function readTaskDiscussionCommentInternal(params: {
  projectId: string;
  taskId: string;
  commentId: string;
  viewerId: string;
}) {
  await assertTaskAccess({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.viewerId,
    mode: "read",
  });

  const [row] = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      deletedAt: taskComments.deletedAt,
      deletedBy: taskComments.deletedBy,
      authorId: profiles.id,
      authorFullName: profiles.fullName,
      authorUsername: profiles.username,
      authorAvatarUrl: profiles.avatarUrl,
    })
    .from(taskComments)
    .leftJoin(profiles, eq(taskComments.userId, profiles.id))
    .where(
      and(
        eq(taskComments.id, params.commentId),
        eq(taskComments.taskId, params.taskId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const { likeCounts, likedIds } = await readDiscussionLikeMaps([row.id], params.viewerId);
  return normalizeTaskDiscussionEntry({
    row: row as DiscussionRow,
    likeCounts,
    likedIds,
  });
}

export async function readTaskDiscussionAction(
  projectId: string,
  taskId: string,
  cursor?: TaskDiscussionCursor | null,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Unauthorized", data: createEmptyTaskDiscussionPage() };
    }

    const data = await readTaskDiscussionInternal({
      projectId,
      taskId,
      viewerId: viewer.userId,
      cursor,
    });

    return { success: true as const, data };
  } catch (error: any) {
    console.error("Failed to read task discussion:", error);
    return {
      success: false as const,
      error: error?.message || "Failed to load discussion",
      data: createEmptyTaskDiscussionPage(),
    };
  }
}

export async function readTaskDiscussionCommentAction(
  projectId: string,
  taskId: string,
  commentId: string,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Unauthorized", data: null };
    }

    const data = await readTaskDiscussionCommentInternal({
      projectId,
      taskId,
      commentId,
      viewerId: viewer.userId,
    });

    return { success: true as const, data };
  } catch (error: any) {
    console.error("Failed to read task discussion comment:", error);
    return {
      success: false as const,
      error: error?.message || "Failed to load comment",
      data: null,
    };
  }
}

export async function createTaskCommentAction(
  taskId: string,
  projectId: string,
  content: string,
  parentCommentId?: string | null,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Unauthorized" };
    }

    const { allowed } = await consumeRateLimit(`task-comment:${viewer.userId}`, 60, 60);
    if (!allowed) {
      return { success: false as const, error: "Rate limit exceeded" };
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { success: false as const, error: "Comment cannot be empty" };
    }

    await assertTaskAccess({
      taskId,
      projectId,
      userId: viewer.userId,
      mode: "write",
    });

    let parentCommentAuthorId: string | null = null;
    if (parentCommentId) {
      const parent = await assertCommentAccess({
        commentId: parentCommentId,
        projectId,
        userId: viewer.userId,
        mode: "read",
      });
      if (parent.taskId !== taskId) {
        return { success: false as const, error: "Reply must belong to the same task" };
      }
      if (parent.parentCommentId) {
        return { success: false as const, error: "Replies can only target top-level comments" };
      }
      if (parent.deletedAt) {
        return { success: false as const, error: "Cannot reply to a deleted comment" };
      }
      parentCommentAuthorId = parent.userId;
    }

    // Mentions are stored inline as `@{userId|DisplayName}` tokens. We parse
    // the content before the insert so we can (a) validate that each mentioned
    // id actually belongs to this project (prevents a crafted payload from
    // pinging strangers), and (b) persist the `comment_mentions` projection
    // used by the inbox + notification fan-out.
    const parsedMentions = parseMentions(trimmedContent);
    const candidateMentionIds = parsedMentions.mentionIds;
    let validatedMentionIds: string[] = [];
    const [projectRow] = await db
      .select({
        ownerId: projects.ownerId,
        slug: projects.slug,
        title: projects.title,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (candidateMentionIds.length > 0) {
      const memberRows = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            inArray(projectMembers.userId, candidateMentionIds),
          ),
        );

      const allowed = new Set<string>(memberRows.map((row) => row.userId));
      if (projectRow?.ownerId) allowed.add(projectRow.ownerId);

      validatedMentionIds = candidateMentionIds.filter((id) => allowed.has(id));
    }

    const createdAt = new Date();

    const [inserted] = await db
      .insert(taskComments)
      .values({
        taskId,
        userId: viewer.userId,
        parentCommentId: parentCommentId ?? null,
        content: trimmedContent,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: taskComments.id });

    if (!inserted?.id) {
      return { success: false as const, error: "Failed to create comment" };
    }

    if (validatedMentionIds.length > 0) {
      // ON CONFLICT DO NOTHING absorbs the UNIQUE(comment_id, mentioned_user_id)
      // collision that would occur if the same user appears in two tokens
      // inside one comment (e.g. "cc @Ada ... also tagging @Ada").
      await db
        .insert(commentMentions)
        .values(
          validatedMentionIds.map((mentionedUserId) => ({
            commentId: inserted.id,
            mentionedUserId,
            createdAt,
          })),
        )
        .onConflictDoNothing({
          target: [commentMentions.commentId, commentMentions.mentionedUserId],
        });

      // Fire-and-forget: a failed notification enqueue must not roll back the
      // comment. The helper itself is structured to never throw, but the
      // await is still wrapped so future implementations (HTTP-backed queue,
      // etc.) inherit the same invariant.
      try {
        await enqueueTaskCommentMentionNotifications({
          recipientUserIds: validatedMentionIds,
          authorUserId: viewer.userId,
          authorDisplayName: viewer.profile?.fullName ?? viewer.profile?.username ?? null,
          authorAvatarUrl: viewer.profile?.avatarUrl ?? null,
          projectId,
          projectSlug: projectRow?.slug ?? null,
          projectLabel: projectRow?.title ?? null,
          taskId,
          commentId: inserted.id,
          parentCommentId: parentCommentId ?? null,
          preview: parsedMentions.plainText,
          createdAt,
        });
      } catch (notifyError) {
        logger.warn("tasks.comment_mention_notification_failed", {
          module: "notifications",
          projectId,
          taskId,
          actorUserId: viewer.userId,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    }

    if (
      parentCommentId &&
      parentCommentAuthorId &&
      parentCommentAuthorId !== viewer.userId &&
      !validatedMentionIds.includes(parentCommentAuthorId)
    ) {
      try {
        await emitTaskCommentReplyNotification({
          recipientUserId: parentCommentAuthorId,
          actorUserId: viewer.userId,
          actorName: viewer.profile?.fullName ?? viewer.profile?.username ?? null,
          actorAvatarUrl: viewer.profile?.avatarUrl ?? null,
          projectId,
          projectSlug: projectRow?.slug ?? null,
          taskId,
          commentId: inserted.id,
          parentCommentId,
          createdAt,
          previewText: parsedMentions.plainText,
          projectLabel: projectRow?.title ?? null,
        });
      } catch (notifyError) {
        logger.warn("tasks.comment_reply_notification_failed", {
          module: "notifications",
          projectId,
          taskId,
          actorUserId: viewer.userId,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    }

    const comment = await readTaskDiscussionCommentInternal({
      projectId,
      taskId,
      commentId: inserted.id,
      viewerId: viewer.userId,
    });
    revalidatePath(`/projects/${projectId}`);

    return {
      success: true as const,
      data: {
        comment,
        mentionIds: validatedMentionIds,
      },
    };
  } catch (error: any) {
    console.error("Failed to create task discussion comment:", error);
    return { success: false as const, error: error?.message || "Failed to create comment" };
  }
}

export async function toggleTaskCommentLikeAction(
  commentId: string,
  projectId: string,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Unauthorized" };
    }

    const comment = await assertCommentAccess({
      commentId,
      projectId,
      userId: viewer.userId,
      mode: "write",
    });
    if (comment.deletedAt) {
      return { success: false as const, error: "Cannot like a deleted comment" };
    }

    const [existingLike] = await db
      .select({ id: taskCommentLikes.id })
      .from(taskCommentLikes)
      .where(
        and(
          eq(taskCommentLikes.commentId, commentId),
          eq(taskCommentLikes.userId, viewer.userId),
        ),
      )
      .limit(1);

    if (existingLike) {
      await db
        .delete(taskCommentLikes)
        .where(eq(taskCommentLikes.id, existingLike.id));
    } else {
      await db.insert(taskCommentLikes).values({
        commentId,
        userId: viewer.userId,
        createdAt: new Date(),
      });
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true as const, liked: !existingLike };
  } catch (error: any) {
    console.error("Failed to toggle task discussion like:", error);
    return { success: false as const, error: error?.message || "Failed to update like" };
  }
}

export async function deleteTaskCommentAction(
  commentId: string,
  projectId: string,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Unauthorized" };
    }

    const comment = await assertCommentAccess({
      commentId,
      projectId,
      userId: viewer.userId,
      mode: "write",
    });
    if (comment.userId !== viewer.userId) {
      return { success: false as const, error: "You can only delete your own comments" };
    }

    let mode: TaskDiscussionDeleteMode = "hard_delete";
    let entry: TaskDiscussionBaseEntry | null = null;

    if (comment.parentCommentId) {
      await db.delete(taskComments).where(eq(taskComments.id, commentId));
    } else {
      const [replyRow] = await db
        .select({ id: taskComments.id })
        .from(taskComments)
        .where(eq(taskComments.parentCommentId, commentId))
        .limit(1);

      if (replyRow) {
        mode = "tombstone";
        await db
          .update(taskComments)
          .set({
            deletedAt: new Date(),
            deletedBy: viewer.userId,
            updatedAt: new Date(),
          })
          .where(eq(taskComments.id, commentId));

        entry = await readTaskDiscussionCommentInternal({
          projectId,
          taskId: comment.taskId,
          commentId,
          viewerId: viewer.userId,
        });
      } else {
        await db.delete(taskComments).where(eq(taskComments.id, commentId));
      }
    }

    revalidatePath(`/projects/${projectId}`);
    return {
      success: true as const,
      data: {
        mode,
        commentId,
        parentCommentId: comment.parentCommentId,
        entry,
      },
    };
  } catch (error: any) {
    console.error("Failed to delete task discussion comment:", error);
    return { success: false as const, error: error?.message || "Failed to delete comment" };
  }
}

export const createCommentAction = createTaskCommentAction;
export const toggleCommentLikeAction = toggleTaskCommentLikeAction;
export const deleteCommentAction = deleteTaskCommentAction;
