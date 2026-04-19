import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTaskActivityItems } from "@/lib/projects/task-activity";

describe("task activity builder", () => {
  it("builds a newest-first feed from persisted task signals only", () => {
    const items = buildTaskActivityItems({
      limit: 10,
      task: {
        id: "task-1",
        title: "Refactor task panel",
        createdAt: "2026-04-17T01:00:00.000Z",
        updatedAt: "2026-04-17T02:00:00.000Z",
        creator: {
          id: "user-1",
          fullName: "Owner One",
          avatarUrl: "https://example.com/owner.png",
        },
      },
      comments: [
        {
          id: "comment-1",
          content: "Looks good",
          createdAt: "2026-04-17T03:00:00.000Z",
          userProfile: {
            id: "user-2",
            fullName: "Peer User",
            avatarUrl: "https://example.com/peer.png",
          },
        },
      ],
      subtasks: [
        {
          id: "subtask-1",
          title: "Ship panel resource",
          completed: true,
          createdAt: "2026-04-17T02:30:00.000Z",
          updatedAt: "2026-04-17T04:00:00.000Z",
        },
      ],
      links: [
        {
          id: "link-1",
          linkedAt: "2026-04-17T05:00:00.000Z",
          node: { name: "TaskDetailPanel.tsx" },
          creator: {
            id: "user-3",
            fullName: "File Owner",
            avatarUrl: null,
          },
        },
      ],
    });

    assert.equal(items[0].type, "file_linked");
    assert.equal(items[0].detail, "TaskDetailPanel.tsx");
    assert.equal(items[1].type, "subtask_updated");
    assert.equal(items[1].summary, "Subtask completed");
    assert.equal(items[2].type, "comment_created");
    assert.equal(items[2].detail, "Looks good");
    assert.equal(items.some((item) => item.type === "task_updated" && item.detail === null), true);
  });

  it("applies the requested limit after sorting", () => {
    const items = buildTaskActivityItems({
      limit: 2,
      task: {
        id: "task-1",
        title: "Refactor task panel",
        createdAt: "2026-04-17T01:00:00.000Z",
        updatedAt: "2026-04-17T02:00:00.000Z",
      },
      comments: [
        {
          id: "comment-1",
          content: "Newest persisted signal",
          createdAt: "2026-04-17T03:00:00.000Z",
        },
      ],
      links: [
        {
          id: "link-1",
          linkedAt: "2026-04-17T05:00:00.000Z",
          node: { name: "TaskFilesExplorer.tsx" },
        },
      ],
    });

    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.type), ["file_linked", "comment_created"]);
  });
});
