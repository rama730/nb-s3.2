import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskPreviewColumns } from "../../src/lib/projects/task-drag-preview";

const workflow = [
    { id: "todo", status: "todo", isDefault: true },
    { id: "progress", status: "in_progress", isDefault: true },
];

const tasks = [
    { id: "first", status: "todo", workflowColumnId: "todo", position: 20 },
    { id: "second", status: "todo", workflowColumnId: "todo", position: 10 },
    { id: "working", status: "in_progress", workflowColumnId: "progress", position: 10 },
];

test("buildTaskPreviewColumns moves only the display projection across columns", () => {
    const preview = buildTaskPreviewColumns(tasks, workflow, {
        taskId: "second",
        columnId: "progress",
        beforeTaskId: "working",
    });

    assert.deepEqual(preview.todo.map((task) => task.id), ["first"]);
    assert.deepEqual(preview.progress.map((task) => task.id), ["second", "working"]);
    assert.equal(preview.progress[0].workflowColumnId, "progress");
    assert.equal(preview.progress[0].status, "in_progress");
    assert.equal(tasks[1].workflowColumnId, "todo");
});

test("buildTaskPreviewColumns reorders inside a column without duplicating the active task", () => {
    const preview = buildTaskPreviewColumns(tasks, workflow, {
        taskId: "second",
        columnId: "todo",
        beforeTaskId: "first",
    });

    assert.deepEqual(preview.todo.map((task) => task.id), ["second", "first"]);
    assert.equal(new Set(preview.todo.map((task) => task.id)).size, preview.todo.length);
});
