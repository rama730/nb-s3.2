import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  patchTaskQueryData,
  removeTaskFromQueryData,
} from "@/lib/projects/task-cache";
import type { TaskSurfaceRecord } from "@/lib/projects/task-presentation";

function buildTask(overrides: Partial<TaskSurfaceRecord> = {}): TaskSurfaceRecord {
  return {
    id: overrides.id ?? "task-1",
    projectId: overrides.projectId ?? "project-1",
    title: overrides.title ?? "Existing task",
    description: overrides.description ?? null,
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "medium",
    assigneeId: overrides.assigneeId ?? "user-1",
    creatorId: overrides.creatorId ?? "user-2",
    sprintId: overrides.sprintId ?? null,
    dueDate: overrides.dueDate ?? null,
    storyPoints: overrides.storyPoints ?? null,
    taskNumber: overrides.taskNumber ?? 12,
    createdAt: overrides.createdAt ?? "2026-04-17T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-17T01:00:00.000Z",
    projectKey: overrides.projectKey ?? "NB",
    assignee: overrides.assignee ?? {
      id: "user-1",
      fullName: "Owner One",
      avatarUrl: "https://example.com/avatar.png",
    },
    creator: overrides.creator ?? null,
    sprint: overrides.sprint ?? null,
  };
}

describe("task cache patching", () => {
  it("preserves related objects when scalar updates arrive without expanded relations", () => {
    const existing = {
      pages: [
        {
          tasks: [buildTask()],
        },
      ],
      pageParams: [undefined],
    };

    const patched = patchTaskQueryData(
      existing,
      buildTask({
        title: "Updated task title",
        updatedAt: "2026-04-17T02:00:00.000Z",
        assignee: null,
      }),
      "all",
    ) as typeof existing;

    assert.equal(patched.pages[0].tasks[0].title, "Updated task title");
    assert.deepEqual(patched.pages[0].tasks[0].assignee, existing.pages[0].tasks[0].assignee);
  });

  it("removes backlog tasks from sprint scope when they lose sprint context", () => {
    const existing = {
      pages: [
        {
          tasks: [buildTask({ sprintId: "sprint-1", sprint: { id: "sprint-1", name: "Sprint 1", status: "active" } })],
        },
      ],
      pageParams: [undefined],
    };

    const patched = patchTaskQueryData(
      existing,
      buildTask({
        sprintId: null,
        sprint: null,
        updatedAt: "2026-04-17T02:00:00.000Z",
      }),
      "sprint",
    ) as typeof existing;

    assert.equal(patched.pages[0].tasks.length, 0);
  });

  it("removes tasks from cached task slices", () => {
    const existing = {
      pages: [
        {
          tasks: [buildTask(), buildTask({ id: "task-2", createdAt: "2026-04-17T02:00:00.000Z" })],
        },
      ],
      pageParams: [undefined],
    };

    const patched = removeTaskFromQueryData(existing, "task-1") as typeof existing;
    assert.deepEqual(patched.pages[0].tasks.map((task) => task.id), ["task-2"]);
  });
});
