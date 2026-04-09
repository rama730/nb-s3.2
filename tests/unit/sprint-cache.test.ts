import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSprintFilterCounts,
  buildSprintHealthSummary,
  type SprintDetailPayload,
} from "@/lib/projects/sprint-detail";
import { patchSprintDetailInfiniteData } from "@/lib/projects/sprint-cache";

function buildPayload(): SprintDetailPayload {
  const sprint = {
    id: "sprint-1",
    projectId: "project-1",
    name: "Sprint 1",
    goal: "Ship sprint improvements",
    startDate: "2026-04-09T00:00:00.000Z",
    endDate: "2026-04-23T00:00:00.000Z",
    status: "active" as const,
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
  };

  const summary = buildSprintHealthSummary({
    totalTasks: 1,
    completedTasks: 0,
    blockedTasks: 0,
    linkedFileCount: 0,
    totalStoryPoints: 3,
    completedStoryPoints: 0,
  });

  return {
    projectId: "project-1",
    projectSlug: "network-for-builders",
    sprints: [sprint],
    selectedSprintId: "sprint-1",
    permissions: {
      canRead: true,
      canWrite: true,
      canCreate: true,
      canStart: true,
      canComplete: true,
      isOwner: true,
      isMember: false,
      memberRole: "owner",
    },
    timelineMode: "chronological",
    summary,
    compareSummary: null,
    filterCounts: buildSprintFilterCounts({
      totalTasks: summary.totalTasks,
      completedTasks: summary.completedTasks,
      blockedTasks: summary.blockedTasks,
      linkedFileCount: summary.linkedFileCount,
    }),
    rows: [
      {
        id: "kickoff",
        kind: "kickoff",
        occurredAt: sprint.startDate,
        sprint,
      },
      {
        id: "task-1",
        kind: "task",
        occurredAt: "2026-04-10T00:00:00.000Z",
        task: {
          id: "task-1",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskNumber: 11,
          title: "Existing sprint task",
          description: null,
          status: "todo",
          priority: "medium",
          storyPoints: 3,
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
        id: "closeout",
        kind: "closeout",
        occurredAt: sprint.endDate,
        sprint,
        summary,
      },
    ],
    drawerPreviews: [
      {
        type: "task",
        id: "task-1",
        title: "NB-11 · Existing sprint task",
        subtitle: "Task detail",
        occurredAt: "2026-04-10T00:00:00.000Z",
        badgeText: "todo",
      },
    ],
    nextCursor: null,
    hasMore: false,
  };
}

describe("sprint cache patching", () => {
  it("adds a task to the selected sprint summary and timeline", () => {
    const payload = buildPayload();
    const patched = patchSprintDetailInfiniteData(
      {
        pages: [payload],
        pageParams: [undefined],
      },
      null,
      {
        id: "task-2",
        projectId: "project-1",
        projectKey: "NB",
        title: "New sprint task",
        description: null,
        status: "todo",
        priority: "high",
        storyPoints: 5,
        sprintId: "sprint-1",
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
        taskNumber: 12,
        assignee: null,
        creator: null,
        linkedFileCount: 2,
        linkedFiles: [
          {
            id: "link-1",
            taskId: "task-2",
            nodeId: "node-1",
            nodeName: "SprintShell.tsx",
            nodePath: "src/SprintShell.tsx",
            nodeType: "file",
            annotation: null,
            linkedAt: "2026-04-11T01:00:00.000Z",
            lastEventType: null,
            lastEventAt: null,
            lastEventBy: null,
          },
          {
            id: "link-2",
            taskId: "task-2",
            nodeId: "node-2",
            nodeName: "SprintHeader.tsx",
            nodePath: "src/SprintHeader.tsx",
            nodeType: "file",
            annotation: null,
            linkedAt: "2026-04-11T02:00:00.000Z",
            lastEventType: null,
            lastEventAt: null,
            lastEventBy: null,
          },
        ],
      },
    ) as { pages: SprintDetailPayload[] };

    const page = patched.pages[0];
    assert.equal(page.summary?.totalTasks, 2);
    assert.equal(page.summary?.totalStoryPoints, 8);
    assert.equal(page.summary?.linkedFileCount, 2);
    assert(page.rows.some((row) => row.kind === "task" && row.task.id === "task-2"));
    assert.equal(page.rows.filter((row) => row.kind === "file" && row.task.id === "task-2").length, 2);
    assert(page.drawerPreviews.some((preview) => preview.type === "task" && preview.id === "task-2"));
    assert(page.drawerPreviews.some((preview) => preview.type === "file" && preview.id === "node-1"));
  });

  it("recomputes completion metrics when a sprint task status changes", () => {
    const payload = buildPayload();
    const patched = patchSprintDetailInfiniteData(
      {
        pages: [payload],
        pageParams: [undefined],
      },
      {
        id: "task-1",
        projectId: "project-1",
        projectKey: "NB",
        title: "Existing sprint task",
        description: null,
        status: "todo",
        priority: "medium",
        storyPoints: 3,
        sprintId: "sprint-1",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        taskNumber: 11,
        assignee: null,
        creator: null,
        linkedFileCount: 0,
      },
      {
        id: "task-1",
        projectId: "project-1",
        projectKey: "NB",
        title: "Existing sprint task",
        description: null,
        status: "done",
        priority: "medium",
        storyPoints: 3,
        sprintId: "sprint-1",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        taskNumber: 11,
        assignee: null,
        creator: null,
        linkedFileCount: 0,
      },
    ) as { pages: SprintDetailPayload[] };

    const page = patched.pages[0];
    assert.equal(page.summary?.completedTasks, 1);
    assert.equal(page.summary?.completedStoryPoints, 3);
    assert.equal(page.summary?.completionPercentage, 100);
    assert.equal(page.filterCounts.completed, 1);
    const updatedTaskRow = page.rows.find((row) => row.kind === "task" && row.task.id === "task-1");
    assert.equal(updatedTaskRow?.kind, "task");
    if (updatedTaskRow?.kind === "task") {
      assert.equal(updatedTaskRow.task.status, "done");
    }
  });
});
