export type TaskDiscussionAuthor = {
  id: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type TaskDiscussionCursor = {
  beforeCreatedAt: string;
  beforeId: string;
};

export type TaskDiscussionDeleteMode = "hard_delete" | "tombstone";

export type TaskDiscussionBaseEntry = {
  id: string;
  taskId: string;
  userId: string;
  parentCommentId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  author: TaskDiscussionAuthor | null;
  likeCount: number;
  likedByViewer: boolean;
  pending?: boolean;
};

export type TaskDiscussionReply = TaskDiscussionBaseEntry;

export type TaskDiscussionComment = TaskDiscussionBaseEntry & {
  replies: TaskDiscussionReply[];
};

export type TaskDiscussionThreadPage = {
  comments: TaskDiscussionComment[];
  nextCursor: TaskDiscussionCursor | null;
  totalCount: number;
};

export type TaskDiscussionTypingContext = {
  scope: "task_comment";
  parentCommentId?: string | null;
};

export type TaskDiscussionTypingUser = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export function createEmptyTaskDiscussionPage(): TaskDiscussionThreadPage {
  return {
    comments: [],
    nextCursor: null,
    totalCount: 0,
  };
}

export function isTaskDiscussionCommentDeleted(entry: Pick<TaskDiscussionBaseEntry, "deletedAt">) {
  return Boolean(entry.deletedAt);
}

export function countTaskDiscussionEntries(page: TaskDiscussionThreadPage) {
  return page.comments.reduce((total, comment) => total + 1 + comment.replies.length, 0);
}

function sortReplies(items: TaskDiscussionReply[]) {
  return [...items].sort((left, right) => {
    const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    return left.id.localeCompare(right.id);
  });
}

function sortComments(items: TaskDiscussionComment[]) {
  return [...items].sort((left, right) => {
    const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    return left.id.localeCompare(right.id);
  });
}

function upsertReply(replies: TaskDiscussionReply[], reply: TaskDiscussionReply) {
  return sortReplies([
    ...replies.filter((item) => item.id !== reply.id && item.id !== `optimistic:${reply.id}`),
    reply,
  ]);
}

function upsertComment(comments: TaskDiscussionComment[], comment: TaskDiscussionComment) {
  return sortComments([
    ...comments.filter((item) => item.id !== comment.id && item.id !== `optimistic:${comment.id}`),
    comment,
  ]);
}

export function mergeTaskDiscussionPage(
  current: TaskDiscussionThreadPage,
  incoming: TaskDiscussionThreadPage,
  mode: "replace" | "prepend_older" = "replace",
): TaskDiscussionThreadPage {
  if (mode === "replace") {
    return {
      comments: sortComments(
        incoming.comments.map((comment) => ({
          ...comment,
          replies: sortReplies(comment.replies),
        })),
      ),
      nextCursor: incoming.nextCursor,
      totalCount: incoming.totalCount,
    };
  }

  const mergedComments = [...current.comments];
  for (const incomingComment of incoming.comments) {
    const existing = mergedComments.find((comment) => comment.id === incomingComment.id);
    if (!existing) {
      mergedComments.push({
        ...incomingComment,
        replies: sortReplies(incomingComment.replies),
      });
      continue;
    }
    existing.replies = sortReplies([
      ...existing.replies,
      ...incomingComment.replies.filter(
        (reply) => !existing.replies.some((existingReply) => existingReply.id === reply.id),
      ),
    ]);
  }

  return {
    comments: sortComments(mergedComments),
    nextCursor: incoming.nextCursor,
    totalCount: Math.max(current.totalCount, incoming.totalCount),
  };
}

export function appendTaskDiscussionEntry(
  current: TaskDiscussionThreadPage,
  entry: TaskDiscussionBaseEntry,
) {
  if (entry.parentCommentId) {
    return {
      ...current,
      comments: current.comments.map((comment) =>
        comment.id === entry.parentCommentId
          ? {
              ...comment,
              replies: upsertReply(comment.replies, entry),
            }
          : comment,
      ),
      totalCount: current.comments.some((comment) => comment.replies.some((reply) => reply.id === entry.id))
        ? current.totalCount
        : current.totalCount + 1,
    };
  }

  const alreadyExists = current.comments.some((comment) => comment.id === entry.id);
  const nextComment: TaskDiscussionComment = {
    ...entry,
    replies: [],
  };
  return {
    ...current,
    comments: upsertComment(current.comments, nextComment),
    totalCount: alreadyExists ? current.totalCount : current.totalCount + 1,
  };
}

export function replaceOptimisticTaskDiscussionEntry(
  current: TaskDiscussionThreadPage,
  optimisticId: string,
  entry: TaskDiscussionBaseEntry,
) {
  if (entry.parentCommentId) {
    return {
      ...current,
      comments: current.comments.map((comment) =>
        comment.id === entry.parentCommentId
          ? {
              ...comment,
              replies: sortReplies(
                comment.replies
                  .filter((reply) => reply.id !== optimisticId && reply.id !== entry.id)
                  .concat(entry),
              ),
            }
          : comment,
      ),
    };
  }

  return {
    ...current,
    comments: sortComments(
      current.comments
        .filter((comment) => comment.id !== optimisticId && comment.id !== entry.id)
        .concat({ ...entry, replies: [] }),
    ),
  };
}

export function reconcileTaskDiscussionInsert(
  current: TaskDiscussionThreadPage,
  entry: TaskDiscussionBaseEntry,
) {
  const optimisticMatch = findMatchingOptimisticDiscussionEntry(current, entry);
  if (optimisticMatch) {
    return replaceOptimisticTaskDiscussionEntry(current, optimisticMatch.id, entry);
  }
  return appendTaskDiscussionEntry(current, entry);
}

function findMatchingOptimisticDiscussionEntry(
  current: TaskDiscussionThreadPage,
  entry: TaskDiscussionBaseEntry,
) {
  const isCloseInTime = (candidateCreatedAt: string) => {
    const deltaMs = Math.abs(Date.parse(entry.createdAt) - Date.parse(candidateCreatedAt));
    return Number.isFinite(deltaMs) && deltaMs <= 15_000;
  };

  if (entry.parentCommentId) {
    const parent = current.comments.find((comment) => comment.id === entry.parentCommentId);
    return (
      parent?.replies.find(
        (reply) =>
          reply.pending
          && reply.userId === entry.userId
          && reply.parentCommentId === entry.parentCommentId
          && reply.content.trim() === entry.content.trim()
          && isCloseInTime(reply.createdAt),
      ) ?? null
    );
  }

  return (
    current.comments.find(
      (comment) =>
        comment.pending
        && comment.userId === entry.userId
        && comment.parentCommentId === null
        && comment.content.trim() === entry.content.trim()
        && isCloseInTime(comment.createdAt),
    ) ?? null
  );
}

export function patchTaskDiscussionEntry(
  current: TaskDiscussionThreadPage,
  entry: TaskDiscussionBaseEntry,
) {
  if (entry.parentCommentId) {
    return {
      ...current,
      comments: current.comments.map((comment) =>
        comment.id === entry.parentCommentId
          ? {
              ...comment,
              replies: upsertReply(comment.replies, entry),
            }
          : comment,
      ),
    };
  }

  return {
    ...current,
    comments: current.comments.map((comment) =>
      comment.id === entry.id
        ? {
            ...entry,
            replies: comment.replies,
          }
        : comment,
    ),
  };
}

export function patchTaskDiscussionLike(
  current: TaskDiscussionThreadPage,
  params: {
    commentId: string;
    userId: string;
    shouldAdd: boolean;
    currentUserId?: string | null;
  },
) {
  const apply = <T extends TaskDiscussionBaseEntry>(entry: T): T => {
    if (entry.id !== params.commentId) return entry;
    const isViewerLikeEvent = Boolean(params.currentUserId && params.userId === params.currentUserId);
    if (isViewerLikeEvent && params.shouldAdd && entry.likedByViewer) {
      return entry;
    }
    if (isViewerLikeEvent && !params.shouldAdd && !entry.likedByViewer) {
      return entry;
    }
    const likedByViewer =
      params.currentUserId && params.userId === params.currentUserId
        ? params.shouldAdd
        : entry.likedByViewer;
    const likeCount = Math.max(0, entry.likeCount + (params.shouldAdd ? 1 : -1));
    return {
      ...entry,
      likedByViewer,
      likeCount,
    };
  };

  return {
    ...current,
    comments: current.comments.map((comment) => ({
      ...apply(comment),
      replies: comment.replies.map((reply) => apply(reply)),
    })),
  };
}

export function removeTaskDiscussionEntry(
  current: TaskDiscussionThreadPage,
  params: {
    commentId: string;
    parentCommentId?: string | null;
  },
) {
  if (params.parentCommentId) {
    let removed = false;
    return {
      ...current,
      comments: current.comments.map((comment) =>
        comment.id === params.parentCommentId
          ? {
              ...comment,
              replies: comment.replies.filter((reply) => {
                const shouldKeep = reply.id !== params.commentId;
                if (!shouldKeep) removed = true;
                return shouldKeep;
              }),
            }
          : comment,
      ),
      totalCount: Math.max(0, current.totalCount - (removed ? 1 : 0)),
    };
  }

  const nextComments = current.comments.filter((comment) => comment.id !== params.commentId);
  return {
    ...current,
    comments: nextComments,
    totalCount: Math.max(0, current.totalCount - (nextComments.length === current.comments.length ? 0 : 1)),
  };
}

export function tombstoneTaskDiscussionEntry(
  current: TaskDiscussionThreadPage,
  params: {
    commentId: string;
    deletedAt: string;
    deletedBy: string | null;
  },
) {
  return {
    ...current,
    comments: current.comments.map((comment) =>
      comment.id === params.commentId
        ? {
            ...comment,
            deletedAt: params.deletedAt,
            deletedBy: params.deletedBy,
            updatedAt: params.deletedAt,
            pending: false,
          }
        : comment,
    ),
  };
}

export function buildOptimisticTaskDiscussionEntry(params: {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  parentCommentId?: string | null;
  createdAt?: string;
  author: TaskDiscussionAuthor | null;
}): TaskDiscussionBaseEntry {
  const createdAt = params.createdAt ?? new Date().toISOString();
  return {
    id: params.id,
    taskId: params.taskId,
    userId: params.userId,
    parentCommentId: params.parentCommentId ?? null,
    content: params.content,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    deletedBy: null,
    author: params.author,
    likeCount: 0,
    likedByViewer: false,
    pending: true,
  };
}
