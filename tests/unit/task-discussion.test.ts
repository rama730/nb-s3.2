import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTaskDiscussionEntry,
  buildOptimisticTaskDiscussionEntry,
  createEmptyTaskDiscussionPage,
  mergeTaskDiscussionPage,
  reconcileTaskDiscussionInsert,
  removeTaskDiscussionEntry,
  tombstoneTaskDiscussionEntry,
  type TaskDiscussionBaseEntry,
  type TaskDiscussionThreadPage,
} from "@/lib/projects/task-discussion";

function createEntry(overrides: Partial<TaskDiscussionBaseEntry> = {}): TaskDiscussionBaseEntry {
  return {
    id: overrides.id ?? "comment-1",
    taskId: overrides.taskId ?? "task-1",
    userId: overrides.userId ?? "user-1",
    parentCommentId: overrides.parentCommentId ?? null,
    content: overrides.content ?? "Hello world",
    createdAt: overrides.createdAt ?? "2026-04-18T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-18T00:00:00.000Z",
    deletedAt: overrides.deletedAt ?? null,
    deletedBy: overrides.deletedBy ?? null,
    author: overrides.author ?? {
      id: "user-1",
      fullName: "Rama",
      username: "rama",
      avatarUrl: null,
    },
    likeCount: overrides.likeCount ?? 0,
    likedByViewer: overrides.likedByViewer ?? false,
    pending: overrides.pending,
  };
}

function createPage(commentIds: string[]): TaskDiscussionThreadPage {
  return {
    comments: commentIds.map((id, index) => ({
      ...createEntry({
        id,
        createdAt: `2026-04-18T00:0${index}:00.000Z`,
        updatedAt: `2026-04-18T00:0${index}:00.000Z`,
      }),
      replies: [],
    })),
    nextCursor: null,
    totalCount: commentIds.length,
  };
}

test("reconcileTaskDiscussionInsert replaces a matching optimistic top-level comment", () => {
  const optimistic = buildOptimisticTaskDiscussionEntry({
    id: "optimistic:1",
    taskId: "task-1",
    userId: "user-1",
    content: "Ship it",
    author: {
      id: "user-1",
      fullName: "Rama",
      username: "rama",
      avatarUrl: null,
    },
    createdAt: "2026-04-18T00:00:00.000Z",
  });

  const page = appendTaskDiscussionEntry(createEmptyTaskDiscussionPage(), optimistic);
  const inserted = reconcileTaskDiscussionInsert(page, createEntry({
    id: "comment-1",
    content: "Ship it",
    createdAt: "2026-04-18T00:00:05.000Z",
    updatedAt: "2026-04-18T00:00:05.000Z",
  }));

  assert.equal(inserted.comments.length, 1);
  assert.equal(inserted.comments[0]?.id, "comment-1");
  assert.equal(inserted.totalCount, 1);
});

test("mergeTaskDiscussionPage prepends older comments without duplicating replies", () => {
  const current = {
    comments: [
      {
        ...createEntry({ id: "comment-2", createdAt: "2026-04-18T00:10:00.000Z", updatedAt: "2026-04-18T00:10:00.000Z" }),
        replies: [
          createEntry({
            id: "reply-1",
            parentCommentId: "comment-2",
            createdAt: "2026-04-18T00:11:00.000Z",
            updatedAt: "2026-04-18T00:11:00.000Z",
          }),
        ],
      },
    ],
    nextCursor: { beforeCreatedAt: "2026-04-17T23:59:00.000Z", beforeId: "comment-1" },
    totalCount: 2,
  } satisfies TaskDiscussionThreadPage;

  const incoming = {
    comments: [
      {
        ...createEntry({ id: "comment-1", createdAt: "2026-04-18T00:00:00.000Z", updatedAt: "2026-04-18T00:00:00.000Z" }),
        replies: [],
      },
      {
        ...createEntry({ id: "comment-2", createdAt: "2026-04-18T00:10:00.000Z", updatedAt: "2026-04-18T00:10:00.000Z" }),
        replies: [
          createEntry({
            id: "reply-1",
            parentCommentId: "comment-2",
            createdAt: "2026-04-18T00:11:00.000Z",
            updatedAt: "2026-04-18T00:11:00.000Z",
          }),
        ],
      },
    ],
    nextCursor: null,
    totalCount: 3,
  } satisfies TaskDiscussionThreadPage;

  const merged = mergeTaskDiscussionPage(current, incoming, "prepend_older");

  assert.deepEqual(merged.comments.map((comment) => comment.id), ["comment-1", "comment-2"]);
  assert.equal(merged.comments[1]?.replies.length, 1);
  assert.equal(merged.totalCount, 3);
});

test("tombstoneTaskDiscussionEntry preserves replies while marking parent deleted", () => {
  const page = {
    comments: [
      {
        ...createEntry({ id: "comment-1" }),
        replies: [
          createEntry({
            id: "reply-1",
            parentCommentId: "comment-1",
            createdAt: "2026-04-18T00:02:00.000Z",
            updatedAt: "2026-04-18T00:02:00.000Z",
          }),
        ],
      },
    ],
    nextCursor: null,
    totalCount: 2,
  } satisfies TaskDiscussionThreadPage;

  const next = tombstoneTaskDiscussionEntry(page, {
    commentId: "comment-1",
    deletedAt: "2026-04-18T00:05:00.000Z",
    deletedBy: "user-1",
  });

  assert.equal(next.comments[0]?.deletedAt, "2026-04-18T00:05:00.000Z");
  assert.equal(next.comments[0]?.replies.length, 1);
  assert.equal(next.totalCount, 2);
});

test("removeTaskDiscussionEntry removes replies without deleting the parent", () => {
  const page = {
    comments: [
      {
        ...createEntry({ id: "comment-1" }),
        replies: [
          createEntry({
            id: "reply-1",
            parentCommentId: "comment-1",
            createdAt: "2026-04-18T00:02:00.000Z",
            updatedAt: "2026-04-18T00:02:00.000Z",
          }),
        ],
      },
    ],
    nextCursor: null,
    totalCount: 2,
  } satisfies TaskDiscussionThreadPage;

  const next = removeTaskDiscussionEntry(page, {
    commentId: "reply-1",
    parentCommentId: "comment-1",
  });

  assert.equal(next.comments.length, 1);
  assert.equal(next.comments[0]?.replies.length, 0);
  assert.equal(next.totalCount, 1);
});

test("createPage helper keeps chronological order assumptions honest", () => {
  const page = createPage(["comment-1", "comment-2"]);
  assert.deepEqual(page.comments.map((comment) => comment.id), ["comment-1", "comment-2"]);
});
