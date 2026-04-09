import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSprintHealthSummary } from "@/lib/projects/sprint-detail";
import { buildSprintTimeline } from "@/lib/projects/sprint-timeline";

describe("sprint timeline", () => {
  it("builds kickoff, task, file, and closeout rows from start to finish", () => {
    const sprint = {
      id: "sprint-1",
      projectId: "project-1",
      name: "Sprint 1",
      goal: "Ship the redesign",
      startDate: "2026-04-09T00:00:00.000Z",
      endDate: "2026-04-23T00:00:00.000Z",
      status: "active" as const,
      createdAt: "2026-04-08T10:00:00.000Z",
      updatedAt: "2026-04-15T12:00:00.000Z",
    };

    const summary = buildSprintHealthSummary({
      totalTasks: 2,
      completedTasks: 1,
      blockedTasks: 0,
      linkedFileCount: 2,
      totalStoryPoints: 8,
      completedStoryPoints: 5,
    });

    const rows = buildSprintTimeline({
      sprint,
      summary,
      tasks: [
        {
          id: "task-1",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskNumber: 12,
          title: "Define timeline structure",
          description: null,
          status: "in_progress",
          priority: "medium",
          storyPoints: 3,
          dueDate: null,
          createdAt: "2026-04-10T08:00:00.000Z",
          updatedAt: "2026-04-11T08:00:00.000Z",
          activityAt: "2026-04-11T08:00:00.000Z",
          linkedFileCount: 0,
          assignee: null,
          creator: null,
          files: [],
        },
        {
          id: "task-2",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskNumber: 13,
          title: "Finish sprint detail view",
          description: null,
          status: "done",
          priority: "high",
          storyPoints: 5,
          dueDate: null,
          createdAt: "2026-04-12T08:00:00.000Z",
          updatedAt: "2026-04-14T08:00:00.000Z",
          activityAt: "2026-04-14T08:00:00.000Z",
          linkedFileCount: 2,
          assignee: null,
          creator: null,
          files: [
            {
              id: "link-1",
              taskId: "task-2",
              nodeId: "node-1",
              nodeName: "SprintShell.tsx",
              nodePath: "Project/SprintShell.tsx",
              nodeType: "file",
              annotation: null,
              linkedAt: "2026-04-13T09:00:00.000Z",
              lastEventType: null,
              lastEventAt: null,
              lastEventBy: null,
            },
            {
              id: "link-2",
              taskId: "task-2",
              nodeId: "node-2",
              nodeName: "sprint-detail.ts",
              nodePath: "Project/sprint-detail.ts",
              nodeType: "file",
              annotation: "Shared presenter contract",
              linkedAt: "2026-04-14T07:00:00.000Z",
              lastEventType: null,
              lastEventAt: null,
              lastEventBy: null,
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      rows.map((row) => row.kind),
      ["kickoff", "task", "file", "file", "task", "closeout"],
    );
    assert.equal(rows[0]?.kind, "kickoff");
    assert.equal(rows[1]?.kind, "task");
    assert.equal(rows[2]?.kind, "file");
    assert.equal(rows[2]?.file.nodeName, "SprintShell.tsx");
    const secondFileRow = rows[3];
    assert.equal(secondFileRow?.kind, "file");
    assert.equal(secondFileRow && secondFileRow.kind === "file" ? secondFileRow.file.nodeName : null, "sprint-detail.ts");
    assert.equal(rows[4]?.kind, "task");
    assert.equal(rows[4]?.task.id, "task-2");
    assert.equal(rows[5]?.kind, "closeout");
  });

  it("can omit kickoff and closeout anchors for follow-up pages", () => {
    const rows = buildSprintTimeline({
      sprint: {
        id: "sprint-empty",
        projectId: "project-1",
        name: "Sprint Empty",
        goal: null,
        startDate: "2026-04-09T00:00:00.000Z",
        endDate: "2026-04-23T00:00:00.000Z",
        status: "planning",
        createdAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:00:00.000Z",
      },
      summary: buildSprintHealthSummary({
        totalTasks: 0,
        completedTasks: 0,
        blockedTasks: 0,
        linkedFileCount: 0,
        totalStoryPoints: 0,
        completedStoryPoints: 0,
      }),
      tasks: [],
      includeKickoff: false,
      includeCloseout: false,
    });

    assert.equal(rows.length, 0);
  });
});
