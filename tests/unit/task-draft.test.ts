import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTaskEditorDraft,
  buildTaskSubmitPayload,
  taskEditorDraftSchema,
} from "@/lib/projects/task-draft";

const projectId = "123e4567-e89b-42d3-a456-426614174000";

describe("task editor draft", () => {
  it("builds stable defaults for the supported task fields", () => {
    assert.deepEqual(buildTaskEditorDraft(), {
      title: "",
      description: "",
      sprintId: null,
      status: "todo",
      priority: "medium",
      assigneeId: null,
      dueDate: null,
    });
  });

  it("accepts blocked status and strips unsupported fields", () => {
    const parsed = taskEditorDraftSchema.parse({
      title: "Fix task panel",
      status: "blocked",
      priority: "urgent",
      type: "bug",
      tags: ["ui"],
    });

    assert.equal(parsed.status, "blocked");
    assert.equal(parsed.priority, "urgent");
    assert.equal("type" in parsed, false);
    assert.equal("tags" in parsed, false);
  });

  it("maps legacy task shape into the canonical draft model", () => {
    assert.deepEqual(
      buildTaskEditorDraft({
        task: {
          title: "Refactor details drawer",
          description: "  keep this tidy  ",
          sprint_id: projectId,
          status: "blocked",
          priority: "high",
          assignee_id: projectId,
          due_date: "2026-04-17T09:30:00.000Z",
        },
      }),
      {
        title: "Refactor details drawer",
        description: "keep this tidy",
        sprintId: projectId,
        status: "blocked",
        priority: "high",
        assigneeId: projectId,
        dueDate: "2026-04-17",
      },
    );
  });

  it("builds a submit payload with only supported task fields", () => {
    const payload = buildTaskSubmitPayload({
      projectId,
      draft: {
        title: "Ship task refactor",
        description: "Tighten task surface",
        sprintId: null,
        status: "blocked",
        priority: "high",
        assigneeId: null,
        dueDate: null,
      },
      subtasks: [{ id: "subtask-1", title: "Verify cache patches" }],
      attachments: [{ id: "node-1" } as any],
    });

    assert.deepEqual(payload, {
      projectId,
      title: "Ship task refactor",
      description: "Tighten task surface",
      sprintId: null,
      status: "blocked",
      priority: "high",
      assigneeId: null,
      dueDate: null,
      attachmentNodeIds: ["node-1"],
      subtasks: [{ title: "Verify cache patches", completed: false }],
    });
    assert.equal("type" in payload, false);
    assert.equal("tags" in payload, false);
  });
});
