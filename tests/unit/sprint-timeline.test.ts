import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSprintHealthSummary,
  formatSprintDateRange,
  isSprintReadyToClose,
  type SprintTaskTimelineEntity,
} from "@/lib/projects/sprint-detail";
import { buildSprintTimeline, mergeSprintTimelineRows } from "@/lib/projects/sprint-timeline";

const sprint = {
  id: "sprint-1", projectId: "project-1", sprintNumber: 1, code: "SPR-1", name: "Sprint 1",
  goal: "Ship the redesign", description: null, startDate: "2026-04-09T00:00:00.000Z",
  endDate: "2026-04-23T00:00:00.000Z", status: "active" as const,
  startedAt: "2026-04-09T00:00:00.000Z", completedAt: null, archivedAt: null, cancelledAt: null,
  createdAt: "2026-04-08T10:00:00.000Z", updatedAt: "2026-04-15T12:00:00.000Z",
  creator: { id: "creator-1", fullName: "Sprint Creator", avatarUrl: null, roleLabel: "Owner" },
};

const summary = buildSprintHealthSummary({ totalTasks: 2, completedTasks: 1, blockedTasks: 0, linkedFileCount: 2, totalStoryPoints: 8, completedStoryPoints: 5 });

function task(id: string, taskNumber: number, addedAt: string): SprintTaskTimelineEntity {
  return {
    id, projectId: "project-1", sprintId: "sprint-1", taskNumber, title: `Task ${taskNumber}`,
    description: null, status: "todo", priority: "medium", storyPoints: null, dueDate: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: addedAt, activityAt: addedAt,
    completedAt: null,
    linkedFileCount: 0, isDeleted: false, membershipState: "committed", addedAt, removedAt: null,
    linkedFiles: [], assignee: null, creator: null,
  };
}

describe("sprint timeline", () => {
  it("orders one outer row per task by durable membership time", () => {
    const rows = buildSprintTimeline({
      sprint,
      summary,
      tasks: [
        task("task-2", 2, "2026-04-12T08:00:00.000Z"),
        task("task-1", 1, "2026-04-10T08:00:00.000Z"),
      ],
    });

    assert.deepEqual(rows.map((row) => row.kind), ["kickoff", "task", "task"]);
    assert.equal(rows[1]?.kind === "task" ? rows[1].task.id : null, "task-1");
    assert.equal(rows[1]?.occurredAt, "2026-04-10T08:00:00.000Z");
  });

  it("uses the actual start timestamp for the sprint kickoff", () => {
    const rows = buildSprintTimeline({ sprint, summary, tasks: [] });
    assert.equal(rows[0]?.occurredAt, sprint.startedAt);
  });

  it("adds closeout to Completed and completed-then-Archived Sprints", () => {
    const completedAt = "2026-04-23T12:00:00.000Z";
    const completed = buildSprintTimeline({ sprint: { ...sprint, status: "completed" as const, completedAt }, summary, tasks: [] });
    const archived = buildSprintTimeline({ sprint: { ...sprint, status: "archived" as const, completedAt, archivedAt: "2026-04-24T00:00:00.000Z" }, summary, tasks: [] });
    assert.deepEqual(completed.map((row) => row.kind), ["kickoff", "closeout"]);
    assert.deepEqual(archived.map((row) => row.kind), ["kickoff", "closeout"]);
    assert.equal(archived[1]?.occurredAt, completedAt);
  });

  it("deduplicates overlapping cursor pages by durable row id", () => {
    const rows = buildSprintTimeline({ sprint, summary, tasks: [] });
    assert.equal(mergeSprintTimelineRows([rows, rows]).length, 1);
  });

  it("treats the configured end as an inclusive calendar day", () => {
    const activeSprint = { ...sprint, endDate: "2026-04-23T00:00:00.000Z" };
    assert.equal(isSprintReadyToClose(activeSprint, new Date("2026-04-23T12:00:00.000Z")), false);
    assert.equal(isSprintReadyToClose(activeSprint, new Date("2026-04-24T00:00:00.000Z")), true);
  });

  it("formats date-only schedules without changing calendar days", () => {
    assert.equal(
      formatSprintDateRange("2026-04-09T00:00:00.000Z", "2026-04-23T00:00:00.000Z"),
      "Apr 9 - Apr 23, 2026",
    );
  });
});
