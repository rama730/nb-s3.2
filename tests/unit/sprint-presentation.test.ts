import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSprintHealthSummary, type SprintTimelineRow } from "@/lib/projects/sprint-detail";
import {
  buildSprintCompareSummary,
  buildSprintTimelineViewModel,
  findPreviousSprintBaseline,
  resolveSprintViewState,
} from "@/lib/projects/sprint-presentation";

function buildRows(): SprintTimelineRow[] {
  const sprint = {
    id: "sprint-2",
    projectId: "project-1",
    name: "Sprint 2",
    goal: "Ship sprint timeline",
    startDate: "2026-04-09T00:00:00.000Z",
    endDate: "2026-04-23T00:00:00.000Z",
    status: "active" as const,
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
  };

  return [
    {
      id: "kickoff",
      kind: "kickoff",
      occurredAt: "2026-04-09T00:00:00.000Z",
      sprint,
    },
    {
      id: "task-a",
      kind: "task",
      occurredAt: "2026-04-10T00:00:00.000Z",
      task: {
        id: "task-a",
        projectId: "project-1",
        sprintId: "sprint-2",
        taskNumber: 21,
        title: "Blocked task",
        description: null,
        status: "blocked",
        priority: "high",
        storyPoints: 3,
        dueDate: null,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
        activityAt: "2026-04-11T00:00:00.000Z",
        linkedFileCount: 1,
        assignee: null,
        creator: null,
      },
    },
    {
      id: "file-a",
      kind: "file",
      occurredAt: "2026-04-11T12:00:00.000Z",
      task: {
        id: "task-a",
        title: "Blocked task",
        taskNumber: 21,
        status: "blocked",
        priority: "high",
      },
      file: {
        id: "file-link-a",
        taskId: "task-a",
        nodeId: "node-a",
        nodeName: "blocked.ts",
        nodePath: "src/blocked.ts",
        nodeType: "file",
        annotation: null,
        linkedAt: "2026-04-11T12:00:00.000Z",
        lastEventType: null,
        lastEventAt: null,
        lastEventBy: null,
      },
    },
    {
      id: "task-b",
      kind: "task",
      occurredAt: "2026-04-12T00:00:00.000Z",
      task: {
        id: "task-b",
        projectId: "project-1",
        sprintId: "sprint-2",
        taskNumber: 22,
        title: "Completed task",
        description: null,
        status: "done",
        priority: "medium",
        storyPoints: 5,
        dueDate: null,
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        activityAt: "2026-04-13T00:00:00.000Z",
        linkedFileCount: 0,
        assignee: null,
        creator: null,
      },
    },
    {
      id: "closeout",
      kind: "closeout",
      occurredAt: "2026-04-14T00:00:00.000Z",
      sprint,
      summary: buildSprintHealthSummary({
        totalTasks: 2,
        completedTasks: 1,
        blockedTasks: 1,
        linkedFileCount: 1,
        totalStoryPoints: 8,
        completedStoryPoints: 5,
      }),
    },
  ];
}

describe("sprint presentation", () => {
  it("prefers explicit URL mode and filter over local preference", () => {
    const resolved = resolveSprintViewState({
      routeState: {
        filter: "blocked",
        mode: "grouped",
        drawer: { type: "none", id: null },
        hasExplicitFilter: true,
        hasExplicitMode: true,
      },
      preference: {
        mode: "files",
        filter: "completed",
      },
    });

    assert.deepEqual(resolved, {
      mode: "grouped",
      filter: "blocked",
    });
  });

  it("uses local preference for mode and normalizes the filter when URL state is absent", () => {
    const resolved = resolveSprintViewState({
      routeState: {
        filter: "all",
        mode: "chronological",
        drawer: { type: "none", id: null },
        hasExplicitFilter: false,
        hasExplicitMode: false,
      },
      preference: {
        mode: "files",
        filter: "files",
      },
    });

    assert.deepEqual(resolved, {
      mode: "files",
      filter: "all",
    });
  });

  it("builds compare summary against the previous sprint baseline", () => {
    const summary = buildSprintHealthSummary({
      totalTasks: 4,
      completedTasks: 3,
      blockedTasks: 1,
      linkedFileCount: 6,
      totalStoryPoints: 13,
      completedStoryPoints: 8,
    });
    const previousSummary = buildSprintHealthSummary({
      totalTasks: 5,
      completedTasks: 2,
      blockedTasks: 2,
      linkedFileCount: 4,
      totalStoryPoints: 13,
      completedStoryPoints: 5,
    });

    const compare = buildSprintCompareSummary({
      selectedSprint: {
        id: "sprint-2",
        projectId: "project-1",
        name: "Sprint 2",
        goal: null,
        startDate: null,
        endDate: null,
        status: "active",
        createdAt: null,
        updatedAt: null,
      },
      summary,
      previousSprint: {
        id: "sprint-1",
        projectId: "project-1",
        name: "Sprint 1",
        goal: null,
        startDate: null,
        endDate: null,
        status: "completed",
        createdAt: null,
        updatedAt: null,
      },
      previousSummary,
    });

    assert.equal(compare.baselineKind, "previous_sprint");
    assert.equal(compare.completionRate.delta, 35);
    assert.equal(compare.blockedTasks.delta, -1);
    assert.equal(compare.linkedFiles.delta, 2);
    assert.equal(compare.completedStoryPoints.delta, 3);
  });

  it("finds the previous sprint baseline from chronological sprint order instead of left-rail status order", () => {
    const previousSprint = findPreviousSprintBaseline(
      [
        {
          id: "planning-newer",
          projectId: "project-1",
          name: "Planning Sprint",
          goal: null,
          startDate: "2026-04-20T00:00:00.000Z",
          endDate: null,
          status: "planning",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        {
          id: "active-current",
          projectId: "project-1",
          name: "Active Sprint",
          goal: null,
          startDate: "2026-04-15T00:00:00.000Z",
          endDate: null,
          status: "active",
          createdAt: "2026-04-15T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        },
        {
          id: "completed-older",
          projectId: "project-1",
          name: "Completed Sprint",
          goal: null,
          startDate: "2026-04-01T00:00:00.000Z",
          endDate: null,
          status: "completed",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      "active-current",
    );

    assert.equal(previousSprint?.id, "completed-older");
  });

  it("projects grouped mode from the same canonical row set", () => {
    const view = buildSprintTimelineViewModel({
      rows: buildRows(),
      mode: "grouped",
      filter: "all",
    });

    assert.equal(view.mode, "grouped");
    assert.equal(view.groups.length, 2);
    assert.equal(view.groups[0]?.taskRow.task.id, "task-a");
    assert.equal(view.groups[0]?.fileRows.length, 1);
    assert.equal(view.visibleCounts.files, 1);
  });

  it("projects file mode without duplicating work-item rows", () => {
    const view = buildSprintTimelineViewModel({
      rows: buildRows(),
      mode: "files",
      filter: "all",
    });

    assert.equal(view.mode, "files");
    assert.deepEqual(
      view.rows.map((row) => row.kind),
      ["kickoff", "file", "closeout"],
    );
    assert.equal(view.visibleCounts.blocked, 1);
    assert.equal(view.visibleCounts.completed, 0);
  });
});
