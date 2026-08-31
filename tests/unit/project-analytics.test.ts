import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
    buildProjectAnalyticsMemberDetail,
    buildProjectAnalyticsMemberSummaries,
    buildProjectAnalyticsOverview,
    buildProjectAnalyticsTimeline,
    filterProjectAnalyticsDatasetByContext,
    resolveProjectAnalyticsAccess,
    type BuildProjectAnalyticsInput,
} from "../../src/lib/projects/analytics";

const baseInput = (): BuildProjectAnalyticsInput => ({
    project: { id: "project-1", slug: "project-one", title: "Project One", ownerId: "owner-1" },
    accessLevel: "owner",
    actorId: "owner-1",
    now: "2026-05-17T00:00:00.000Z",
    members: [
        {
            id: "pm-owner",
            userId: "owner-1",
            role: "owner",
            joinedAt: "2026-05-01T00:00:00.000Z",
            user: { id: "owner-1", fullName: "Owner One", username: "owner", avatarUrl: null },
        },
        {
            id: "pm-admin",
            userId: "admin-1",
            role: "admin",
            joinedAt: "2026-05-02T00:00:00.000Z",
            user: { id: "admin-1", fullName: "Admin One", username: "admin", avatarUrl: null },
        },
        {
            id: "pm-member",
            userId: "member-1",
            role: "member",
            joinedAt: "2026-05-03T00:00:00.000Z",
            user: { id: "member-1", fullName: "Member One", username: "member", avatarUrl: null },
        },
    ],
    profiles: [{ id: "former-1", fullName: "Former One", username: "former", avatarUrl: null }],
    tasks: [
        {
            id: "task-1",
            title: "Blocked API work",
            status: "blocked",
            priority: "high",
            assigneeId: "member-1",
            creatorId: "owner-1",
            sprintId: "sprint-1",
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-05T00:00:00.000Z",
        },
        {
            id: "task-2",
            title: "Done design pass",
            status: "done",
            priority: "medium",
            assigneeId: "admin-1",
            creatorId: "owner-1",
            sprintId: "sprint-1",
            createdAt: "2026-05-02T00:00:00.000Z",
            updatedAt: "2026-05-16T00:00:00.000Z",
        },
        {
            id: "task-3",
            title: "Unassigned QA",
            status: "in_progress",
            priority: "low",
            assigneeId: null,
            creatorId: "owner-1",
            sprintId: null,
            createdAt: "2026-05-03T00:00:00.000Z",
            updatedAt: "2026-05-03T00:00:00.000Z",
        },
        {
            id: "task-4",
            title: "Former member task",
            status: "todo",
            priority: "urgent",
            assigneeId: "former-1",
            creatorId: "owner-1",
            sprintId: null,
            createdAt: "2026-05-04T00:00:00.000Z",
            updatedAt: "2026-05-04T00:00:00.000Z",
        },
    ],
    sprints: [
        {
            id: "sprint-1",
            name: "Sprint 1",
            status: "active",
            startDate: "2026-05-01T00:00:00.000Z",
            endDate: "2026-05-10T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-10T00:00:00.000Z",
        },
    ],
    files: [
        {
            id: "file-1",
            name: "Design.png",
            type: "file",
            createdBy: "member-1",
            createdAt: "2026-05-04T00:00:00.000Z",
            updatedAt: "2026-05-16T00:00:00.000Z",
        },
    ],
    fileVersions: [{ id: "version-1", nodeId: "file-1", uploadedBy: "member-1", uploadedAt: "2026-05-16T00:00:00.000Z" }],
    taskFileLinks: [{ id: "link-1", taskId: "task-1", nodeId: "file-1", annotation: "Needs review", linkedAt: "2026-05-16T00:00:00.000Z" }],
    comments: [{ id: "comment-1", taskId: "task-1", userId: "member-1", createdAt: "2026-05-16T00:00:00.000Z" }],
    applications: [{ id: "app-1", applicantId: "member-1", status: "pending", createdAt: "2026-05-15T00:00:00.000Z", updatedAt: "2026-05-15T00:00:00.000Z" }],
    roles: [{ id: "role-1", title: "Designer", role: "designer", count: 2, filled: 1, updatedAt: "2026-05-15T00:00:00.000Z" }],
    workflows: [{ id: "workflow-1", targetId: "task-1", status: "pending", assigneeUserId: "member-1", createdBy: "owner-1", createdAt: "2026-05-12T00:00:00.000Z", updatedAt: "2026-05-12T00:00:00.000Z" }],
    events: [{ id: "event-1", type: "project_member.role_changed", actorId: "owner-1", metadata: {}, createdAt: "2026-05-16T12:00:00.000Z" }],
});

test("analytics access resolves owner, co-leader, member, viewer, public, and removed users", () => {
    const members = [
        { userId: "admin-1", role: "admin" },
        { userId: "member-1", role: "member" },
        { userId: "viewer-1", role: "viewer" },
    ];
    assert.equal(resolveProjectAnalyticsAccess({ actorId: "owner-1", projectOwnerId: "owner-1", members }), "owner");
    assert.equal(resolveProjectAnalyticsAccess({ actorId: "admin-1", projectOwnerId: "owner-1", members }), "co_leader");
    assert.equal(resolveProjectAnalyticsAccess({ actorId: "member-1", projectOwnerId: "owner-1", members }), "member");
    assert.equal(resolveProjectAnalyticsAccess({ actorId: "viewer-1", projectOwnerId: "owner-1", members }), "viewer");
    assert.equal(resolveProjectAnalyticsAccess({ actorId: null, projectOwnerId: "owner-1", members }), "public");
    assert.equal(resolveProjectAnalyticsAccess({ actorId: "removed-1", projectOwnerId: "owner-1", members }), "public");
});

test("overview builds pulse, attention, and recent movement from deterministic input", () => {
    const overview = buildProjectAnalyticsOverview(baseInput());
    assert.equal(overview.pulse.activeWork, 3);
    assert.equal(overview.pulse.completedWork, 1);
    assert.equal(overview.pulse.blockedWork, 1);
    assert.ok(overview.commandCenter.length > 0);
    assert.ok(overview.needsAttention.some((insight) => insight.id === "stale-work"));
    assert.ok(overview.needsAttention.every((insight) => insight.actionLink.href.includes("/projects/project-one")));
    assert.ok(overview.recentMovement.length > 0);
    assert.ok(Array.isArray(overview.nextMoves));
    assert.equal(overview.sourceSummary.caps?.tasks, 500);
    assert.equal(overview.sourceSummary.capped?.tasks, false);
    assert.equal(overview.comparison.label, "Last 30 days vs prior 30 days");
    assert.equal(typeof overview.comparison.movementDelta, "number");
});

test("member summaries are role grouped rather than leaderboard ranked", () => {
    const summaries = buildProjectAnalyticsMemberSummaries(baseInput());
    assert.deepEqual(summaries.map((summary) => summary.person.roleLabel), ["Owner", "Co-leader", "Member"]);
    const member = summaries.find((summary) => summary.person.id === "member-1");
    assert.equal(member?.blockedTasks, 1);
    assert.ok(member?.supportSignals.some((signal) => signal.id.includes("blocked")));
});

test("member detail separates responsibility buckets and contribution contexts", () => {
    const detail = buildProjectAnalyticsMemberDetail(baseInput(), "member-1");
    assert.equal(detail.currentResponsibilities.length, 1);
    assert.equal(detail.blockedWork.length, 1);
    assert.equal(detail.completedWork.length, 0);
    assert.equal(detail.fileContribution.length, 1);
    assert.equal(detail.fileContributionTotal, 1);
    assert.ok(detail.fileContribution[0]?.latestChangedAt);
    assert.ok(detail.collaborationActivity.length > 0);
});

test("context filtering narrows analytics data before builders run", () => {
    const scoped = filterProjectAnalyticsDatasetByContext(baseInput(), {
        memberId: "member-1",
        source: "tasks",
        dateRange: "90d",
    });
    assert.ok(scoped.tasks.length > 0);
    assert.ok(scoped.tasks.every((task) => task.assigneeId === "member-1" || task.creatorId === "member-1"));
    assert.equal(scoped.files.length, 0);
});

test("timeline prefers durable task and sprint history over state snapshots", () => {
    const input = baseInput();
    input.taskEvents = [{
        id: "task-event-1",
        taskId: "task-1",
        actorId: "member-1",
        eventType: "status_changed",
        payload: { from: "todo", to: "blocked" },
        createdAt: "2026-05-06T00:00:00.000Z",
    }];
    input.sprintEvents = [{
        id: "sprint-event-1",
        sprintId: "sprint-1",
        actorId: "owner-1",
        eventType: "created",
        payload: {},
        createdAt: "2026-05-01T00:00:00.000Z",
    }];

    const timeline = buildProjectAnalyticsTimeline(input, { limit: 50 });
    assert.ok(timeline.items.some((event) => event.id === "task-event:task-event-1"));
    assert.ok(timeline.items.some((event) => event.id === "sprint-event:sprint-event-1"));
    assert.equal(timeline.items.some((event) => event.id === "task:task-1:updated"), false);
    assert.equal(timeline.items.some((event) => event.id === "sprint:sprint-1"), false);
});

test("private files are removed before analytics builders run", () => {
    const input = baseInput();
    input.files.push({
        id: "file-private",
        name: "Private notes.md",
        type: "file",
        createdBy: "owner-1",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
        source: "manual",
        analyticsVisible: false,
        publicVisible: false,
        privateReason: "User kept this file private",
    });
    input.fileVersions.push({ id: "version-private", nodeId: "file-private", uploadedBy: "owner-1", uploadedAt: "2026-05-16T00:00:00.000Z" });
    const scoped = filterProjectAnalyticsDatasetByContext(input, { source: "all", dateRange: "all", memberId: null });
    assert.equal(scoped.files.some((file) => file.id === "file-private"), false);
    assert.equal(scoped.fileVersions.some((version) => version.nodeId === "file-private"), false);
    const overview = buildProjectAnalyticsOverview({ ...scoped, hiddenPrivateFiles: 1 });
    assert.equal(overview.sourceSummary.privateFilesHidden, 1);
});

test("github file imports are grouped instead of rendered as a file feed", () => {
    const input = baseInput();
    input.project.importSourceType = "github";
    input.files = Array.from({ length: 8 }, (_, index) => ({
        id: `github-file-${index}`,
        name: `file-${index}.ts`,
        path: `/src/file-${index}.ts`,
        type: "file",
        createdBy: "owner-1",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
        source: "github",
        analyticsVisible: true,
        publicVisible: true,
    }));
    input.fileVersions = [];
    const timeline = buildProjectAnalyticsTimeline(input, { source: "files", limit: 20 });
    const grouped = timeline.items.find((event) => event.id.startsWith("file-group:github"));
    assert.equal(grouped?.title, "Repository files indexed");
    assert.equal(grouped?.groupedCount, 8);
    assert.equal(grouped?.representativeNames?.length, 4);
});

test("member file contribution returns the four most recent files with the full total", () => {
    const input = baseInput();
    input.files = Array.from({ length: 6 }, (_, index) => ({
        id: `member-file-${index}`,
        name: `member-${index}.md`,
        type: "file",
        createdBy: "member-1",
        createdAt: `2026-05-${10 + index}T00:00:00.000Z`,
        updatedAt: `2026-05-${10 + index}T00:00:00.000Z`,
        source: "manual",
        analyticsVisible: true,
        publicVisible: true,
    }));
    input.fileVersions = input.files.map((file, index) => ({
        id: `member-version-${index}`,
        nodeId: file.id,
        uploadedBy: "member-1",
        uploadedAt: file.updatedAt,
    }));
    const detail = buildProjectAnalyticsMemberDetail(input, "member-1");
    assert.equal(detail.fileContribution.length, 4);
    assert.equal(detail.fileContributionTotal, 6);
    assert.equal(detail.fileContribution[0]?.fileName, "member-5.md");
});

test("timeline attributes file movement to the latest version uploader", () => {
    const input = baseInput();
    input.files[0] = {
        ...input.files[0]!,
        createdBy: "owner-1",
        updatedAt: "2026-05-15T00:00:00.000Z",
    };
    input.fileVersions = [
        { id: "version-old", nodeId: "file-1", uploadedBy: "owner-1", uploadedAt: "2026-05-15T00:00:00.000Z" },
        { id: "version-latest", nodeId: "file-1", uploadedBy: "member-1", uploadedAt: "2026-05-16T08:30:00.000Z" },
    ];

    const timeline = buildProjectAnalyticsTimeline(input, { source: "files", limit: 10 });
    const fileEvent = timeline.items.find((event) => event.id === "file:file-1");
    assert.equal(fileEvent?.actor?.id, "member-1");
    assert.equal(fileEvent?.occurredAt, "2026-05-16T08:30:00.000Z");
});

test("timeline sorts chronologically and filters by member and type", () => {
    const input = baseInput();
    const timeline = buildProjectAnalyticsTimeline(input, { limit: 20 });
    assert.ok(timeline.items.length > 1);
    const first = timeline.items[0]!;
    const second = timeline.items[1]!;
    assert.ok(new Date(first.occurredAt).getTime() >= new Date(second.occurredAt).getTime());

    const memberTimeline = buildProjectAnalyticsTimeline(input, { memberId: "member-1", type: "task" });
    assert.ok(memberTimeline.items.every((event) => event.type === "task"));
    assert.ok(memberTimeline.items.every((event) => event.actor?.id === "member-1"));
});

test("timeline filters by source surface and paginates with a cursor", () => {
    const input = baseInput();
    const fileTimeline = buildProjectAnalyticsTimeline(input, { source: "files", limit: 10 });
    assert.ok(fileTimeline.items.length > 0);
    assert.ok(fileTimeline.items.every((event) => event.sourceSurface === "files"));

    const firstPage = buildProjectAnalyticsTimeline(input, { limit: 2 });
    assert.equal(firstPage.items.length, 2);
    assert.ok(firstPage.nextCursor);
    const secondPage = buildProjectAnalyticsTimeline(input, { limit: 2, cursor: firstPage.nextCursor });
    assert.ok(secondPage.items.every((event) => new Date(event.occurredAt) < new Date(firstPage.nextCursor!)));
});

test("analytics action links deep-link to project surfaces", () => {
    const overview = buildProjectAnalyticsOverview(baseInput());
    const stale = overview.needsAttention.find((insight) => insight.id === "stale-work");
    assert.ok(stale?.actionLink.href.includes("tab=tasks"));
    assert.ok(stale?.actionLink.href.includes("taskId=task-1"));
});

test("removed-member data renders as historical context only", () => {
    const detail = buildProjectAnalyticsMemberDetail(baseInput(), "former-1");
    assert.equal(detail.person.roleLabel, "Former collaborator");
    assert.equal(detail.person.subtext, "Removed from project");
    assert.equal(detail.currentResponsibilities.length, 1);
});

test("analytics UI source contracts expose live tabs, pagination, and accessible skeleton", () => {
    const root = process.cwd();
    const analyticsTab = readFileSync(`${root}/src/components/projects/tabs/AnalyticsTab.tsx`, "utf8");
    const overview = readFileSync(`${root}/src/components/projects/analytics/AnalyticsOverview.tsx`, "utf8");
    const timeline = readFileSync(`${root}/src/components/projects/analytics/AnalyticsTimeline.tsx`, "utf8");
    const skeleton = readFileSync(`${root}/src/components/projects/skeletons/SkeletonAnalytics.tsx`, "utf8");

    const tabBlock = analyticsTab.match(/const ANALYTICS_TABS:[\s\S]*?\];/)?.[0] ?? "";
    for (const tab of ["overview", "members", "timeline"]) {
        assert.ok(tabBlock.includes(`"${tab}"`), `Analytics tab is missing ${tab}`);
    }
    for (const deletedTab of ["workflow", "sprints", "files", "risks"]) {
        assert.equal(tabBlock.includes(`"${deletedTab}"`), false, `Analytics tab still exposes ${deletedTab}`);
    }
    for (const deletedPane of ["AnalyticsFiles.tsx", "AnalyticsSprints.tsx", "AnalyticsRisks.tsx", "AnalyticsWorkflow.tsx"]) {
        assert.equal(existsSync(`${root}/src/components/projects/analytics/${deletedPane}`), false, `${deletedPane} should stay deleted`);
    }
    assert.equal(analyticsTab.includes("Export report"), false);
    assert.ok(analyticsTab.includes("analyticsWindow"));
    assert.equal(timeline.includes("SOURCE_SURFACES"), false);
    assert.equal(timeline.includes("onContextChange"), false);
    assert.equal(timeline.includes("useProjectAnalyticsMembers"), false);
    assert.ok(timeline.includes("groupTimelineByDay"));
    assert.ok(timeline.includes("file-summary"));
    assert.ok(timeline.includes("Load more movement"));
    assert.ok(overview.includes("Next moves"));
    assert.ok(overview.includes("Recent Moments"));
    assert.equal(overview.includes("Chronological project trail"), false);
    assert.ok(overview.includes("Compare mode"));
    assert.ok(overview.includes("AnalyticsCoverageNote"));
    assert.ok(skeleton.includes('role="status"'));
    assert.ok(skeleton.includes('aria-hidden="true"'));
});
