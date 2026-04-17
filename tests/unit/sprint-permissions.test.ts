import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSprintFilterCounts,
  buildSprintHealthSummary,
  buildSprintPermissionSet,
  filterSprintTimelineRows,
  type SprintTimelineRow,
} from "@/lib/projects/sprint-detail";

describe("sprint permissions and presentation helpers", () => {
  it("grants lifecycle controls to members with write access", () => {
    const permissions = buildSprintPermissionSet({
      canRead: true,
      canWrite: true,
      isOwner: false,
      isMember: true,
      memberRole: "member",
    });

    assert.deepEqual(permissions, {
      canRead: true,
      canWrite: true,
      canCreate: true,
      canStart: true,
      canComplete: true,
      isOwner: false,
      isMember: true,
      memberRole: "member",
    });
  });

  it("keeps viewers read-only", () => {
    const permissions = buildSprintPermissionSet({
      canRead: true,
      canWrite: false,
      isOwner: false,
      isMember: false,
      memberRole: "viewer",
    });

    assert.equal(permissions.canCreate, false);
    assert.equal(permissions.canStart, false);
    assert.equal(permissions.canComplete, false);
  });

  it("builds compact health and filter summaries from canonical counts", () => {
    const summary = buildSprintHealthSummary({
      totalTasks: 5,
      completedTasks: 2,
      blockedTasks: 1,
      linkedFileCount: 3,
      totalStoryPoints: 13,
      completedStoryPoints: 5,
    });

    const counts = buildSprintFilterCounts({
      totalTasks: summary.totalTasks,
      completedTasks: summary.completedTasks,
      blockedTasks: summary.blockedTasks,
      linkedFileCount: summary.linkedFileCount,
    });

    assert.equal(summary.completionPercentage, 40);
    assert.deepEqual(counts, {
      all: 8,
      work: 5,
      blocked: 1,
      completed: 2,
      files: 3,
    });
  });

  it("filters the timeline without dropping structural anchors", () => {
    const rows: SprintTimelineRow[] = [
      {
        id: "kickoff",
        kind: "kickoff",
        occurredAt: "2026-04-09T00:00:00.000Z",
        sprint: {
          id: "sprint-1",
          projectId: "project-1",
          name: "Sprint 1",
          goal: null,
          description: null,
          startDate: "2026-04-09T00:00:00.000Z",
          endDate: "2026-04-23T00:00:00.000Z",
          status: "active",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
      },
      {
        id: "task-blocked",
        kind: "task",
        occurredAt: "2026-04-10T00:00:00.000Z",
        task: {
          id: "task-blocked",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskNumber: 1,
          title: "Blocked task",
          description: null,
          status: "blocked",
          priority: "high",
          storyPoints: 2,
          dueDate: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
          activityAt: "2026-04-10T00:00:00.000Z",
          linkedFileCount: 0,
          assignee: null,
          creator: null,
        },
      },
      {
        id: "file-1",
        kind: "file",
        occurredAt: "2026-04-11T00:00:00.000Z",
        task: {
          id: "task-blocked",
          title: "Blocked task",
          taskNumber: 1,
          status: "blocked",
          priority: "high",
        },
        file: {
          id: "file-link-1",
          taskId: "task-blocked",
          nodeId: "node-1",
          nodeName: "blocked.ts",
          nodePath: "src/blocked.ts",
          nodeType: "file",
          annotation: null,
          linkedAt: "2026-04-11T00:00:00.000Z",
          lastEventType: "updated",
          lastEventAt: "2026-04-11T01:00:00.000Z",
          lastEventBy: "Sprint Owner",
        },
      },
      {
        id: "closeout",
        kind: "closeout",
        occurredAt: "2026-04-12T00:00:00.000Z",
        sprint: {
          id: "sprint-1",
          projectId: "project-1",
          name: "Sprint 1",
          goal: null,
          description: null,
          startDate: "2026-04-09T00:00:00.000Z",
          endDate: "2026-04-23T00:00:00.000Z",
          status: "active",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
        summary: buildSprintHealthSummary({
          totalTasks: 1,
          completedTasks: 0,
          blockedTasks: 1,
          linkedFileCount: 1,
          totalStoryPoints: 2,
          completedStoryPoints: 0,
        }),
      },
    ];

    const blockedRows = filterSprintTimelineRows(rows, "blocked");
    const fileRows = filterSprintTimelineRows(rows, "files");

    assert.deepEqual(
      blockedRows.map((row) => row.kind),
      ["kickoff", "task", "closeout"],
    );
    assert.deepEqual(
      fileRows.map((row) => row.kind),
      ["kickoff", "file", "closeout"],
    );
  });
});
