import assert from "node:assert/strict";
import test from "node:test";
import type { TaskSurfaceRecord } from "@/lib/projects/task-presentation";
import {
    FOCUS_STRIP_COMFORTABLE_MIN_WIDTH,
    compareFocusTasks,
    getFocusDescriptionLineClamp,
    getFocusStripMode,
    getFocusTaskUrgency,
    rankFocusTasks,
} from "@/lib/projects/task-focus";

function buildTask(overrides: Partial<TaskSurfaceRecord> = {}): TaskSurfaceRecord {
    return {
        id: overrides.id ?? "task-a",
        projectId: overrides.projectId ?? "project-1",
        title: overrides.title ?? "Task title",
        description: overrides.description ?? null,
        status: overrides.status ?? "todo",
        priority: overrides.priority ?? "medium",
        assigneeId: overrides.assigneeId ?? null,
        creatorId: overrides.creatorId ?? "creator-1",
        sprintId: overrides.sprintId ?? null,
        dueDate: overrides.dueDate ?? null,
        storyPoints: overrides.storyPoints ?? null,
        taskNumber: overrides.taskNumber ?? 1,
        createdAt: overrides.createdAt ?? "2026-03-20T10:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-03-20T11:00:00.000Z",
        projectKey: overrides.projectKey ?? "NB",
        assignee: overrides.assignee ?? null,
        creator: overrides.creator ?? null,
        sprint: overrides.sprint ?? null,
    };
}

test("focus strip mode is comfortable only for 1-2 tasks at the width threshold", () => {
    assert.equal(getFocusStripMode(1, FOCUS_STRIP_COMFORTABLE_MIN_WIDTH), "comfortable");
    assert.equal(getFocusStripMode(2, FOCUS_STRIP_COMFORTABLE_MIN_WIDTH + 40), "comfortable");
    assert.equal(getFocusStripMode(2, FOCUS_STRIP_COMFORTABLE_MIN_WIDTH - 1), "compact");
    assert.equal(getFocusStripMode(3, FOCUS_STRIP_COMFORTABLE_MIN_WIDTH + 80), "compact");
    assert.equal(getFocusStripMode(1, null), "compact");
});

test("focus description clamp follows strip mode and task count", () => {
    assert.equal(getFocusDescriptionLineClamp("comfortable", 1, "Needs follow-up"), 2);
    assert.equal(getFocusDescriptionLineClamp("comfortable", 2, "Needs follow-up"), 1);
    assert.equal(getFocusDescriptionLineClamp("comfortable", 3, "Needs follow-up"), 0);
    assert.equal(getFocusDescriptionLineClamp("compact", 1, "Needs follow-up"), 0);
    assert.equal(getFocusDescriptionLineClamp("comfortable", 1, ""), 0);
});

test("focus urgency distinguishes overdue, due today, blocked, and normal tasks", () => {
    const referenceNow = new Date("2026-03-20T15:00:00.000Z");

    assert.equal(
        getFocusTaskUrgency(buildTask({ dueDate: "2026-03-20T09:00:00.000Z" }), referenceNow),
        "overdue",
    );
    assert.equal(
        getFocusTaskUrgency(buildTask({ dueDate: "2026-03-20T18:00:00.000Z" }), referenceNow),
        "due_today",
    );
    assert.equal(
        getFocusTaskUrgency(buildTask({ status: "blocked", dueDate: null }), referenceNow),
        "blocked",
    );
    assert.equal(
        getFocusTaskUrgency(buildTask({ dueDate: "2026-03-22T18:00:00.000Z" }), referenceNow),
        "normal",
    );
});

test("focus tasks rank by urgency, then priority, then freshness", () => {
    const referenceNow = new Date("2026-03-20T15:00:00.000Z");
    const ranked = rankFocusTasks([
        buildTask({
            id: "normal-medium",
            priority: "medium",
            updatedAt: "2026-03-20T08:00:00.000Z",
        }),
        buildTask({
            id: "blocked-task",
            status: "blocked",
            priority: "low",
        }),
        buildTask({
            id: "urgent-task",
            priority: "urgent",
            updatedAt: "2026-03-20T09:00:00.000Z",
        }),
        buildTask({
            id: "due-today",
            dueDate: "2026-03-20T18:00:00.000Z",
        }),
        buildTask({
            id: "overdue-task",
            dueDate: "2026-03-20T09:00:00.000Z",
        }),
        buildTask({
            id: "fresh-medium",
            priority: "medium",
            updatedAt: "2026-03-20T10:00:00.000Z",
        }),
    ], referenceNow);

    assert.deepEqual(
        ranked.map((task) => task.id),
        ["overdue-task", "due-today", "blocked-task", "urgent-task", "fresh-medium", "normal-medium"],
    );
});

test("focus task comparison falls back to createdAt and id deterministically", () => {
    const referenceNow = new Date("2026-03-20T15:00:00.000Z");
    const newerCreated = buildTask({
        id: "b-task",
        createdAt: "2026-03-20T12:00:00.000Z",
        updatedAt: null,
    });
    const olderCreated = buildTask({
        id: "a-task",
        createdAt: "2026-03-20T11:00:00.000Z",
        updatedAt: null,
    });
    const sameTimestampsA = buildTask({
        id: "a-task",
        createdAt: "2026-03-20T11:00:00.000Z",
        updatedAt: "2026-03-20T11:00:00.000Z",
    });
    const sameTimestampsB = buildTask({
        id: "b-task",
        createdAt: "2026-03-20T11:00:00.000Z",
        updatedAt: "2026-03-20T11:00:00.000Z",
    });

    assert.ok(compareFocusTasks(newerCreated, olderCreated, referenceNow) < 0);
    assert.ok(compareFocusTasks(sameTimestampsA, sameTimestampsB, referenceNow) < 0);
});
