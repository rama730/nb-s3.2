import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("task-board workflow is hydrated and synchronized through its dedicated column resource", () => {
    const taskTab = readProjectFile("src/components/projects/v2/TasksTab.tsx");
    const action = readProjectFile("src/app/actions/project/workflow.ts");
    const subscriptions = readProjectFile("src/lib/realtime/subscriptions.ts");
    const schema = readProjectFile("src/lib/db/schema/index.ts");
    const migration = readProjectFile("drizzle/0139_project_workflow_columns.sql");
    const realtimeMigration = readProjectFile("drizzle/0142_project_workflow_columns_realtime.sql");

    assert.match(taskTab, /getProjectWorkflowColumnsAction/);
    assert.match(taskTab, /subscribeActiveResource/);
    assert.match(taskTab, /table: "project_workflow_columns"/);
    assert.match(taskTab, /scheduleWorkflowRefresh/);
    assert.match(taskTab, /if \(!result\.success \|\| !result\.columns\)/);
    assert.match(taskTab, /normalizeAssignableMembers\(members\)/);
    assert.match(action, /updateProjectWorkflowColumnsAction/);
    assert.match(schema, /projectWorkflowColumns/);
    assert.match(subscriptions, /'project_workflow'/);
    assert.match(migration, /project_workflow_columns/);
    assert.match(realtimeMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.project_workflow_columns/);
    assert.match(realtimeMigration, /app_private\.nb_project_can_read\(project_id\)/);
});

test("workflow columns keep four default categories while allowing two project-specific sections", () => {
    const taskTab = readProjectFile("src/components/projects/v2/TasksTab.tsx");
    const action = readProjectFile("src/app/actions/project/workflow.ts");
    const board = readProjectFile("src/components/projects/v2/tasks/KanbanBoard.tsx");
    const realtime = readProjectFile("src/hooks/useRealtimeTasks.ts");
    const schema = readProjectFile("src/lib/db/schema/index.ts");
    const migration = readProjectFile("drizzle/0139_project_workflow_columns.sql");
    const legacyBackfill = readProjectFile("drizzle/0141_project_workflow_legacy_presentation_backfill.sql");

    assert.match(action, /\.min\(4\)\.max\(6\)/);
    assert.match(action, /createProjectWorkflowColumnAction/);
    assert.match(action, /deleteProjectWorkflowColumnAction/);
    assert.match(taskTab, /Add Section/);
    assert.match(taskTab, /<Dialog/);
    assert.doesNotMatch(taskTab, /window\.prompt/);
    assert.match(board, /workflowColumnId/);
    assert.match(board, /activationConstraint: \{ distance: 8 \}/);
    assert.match(board, /autoScroll=\{\{/);
    assert.match(board, /acceleration: 12/);
    assert.match(board, /collisionDetection=\{closestCenter\}/);
    assert.match(board, /adjustScale=\{false\}/);
    assert.match(board, /activeTaskWidth/);
    assert.match(board, /<TaskCard task=\{activeTask\} \/>/);
    assert.match(board, /flex items-start gap-6/);
    assert.match(board, /taskSizesRef/);
    assert.match(board, /getBoundingClientRect/);
    assert.match(board, /buildTaskPreviewColumns/);
    assert.match(board, /previewMove/);
    assert.doesNotMatch(board, /DropIndicator/);
    assert.match(board, /onTaskDragStateChange/);
    const dragOver = board.slice(board.indexOf("function onDragOver"), board.indexOf("async function onDragEnd"));
    assert.doesNotMatch(dragOver, /setTasks/);
    assert.match(dragOver, /setPreviewMove/);
    const dragCancel = board.slice(board.indexOf("function onDragCancel"), board.indexOf("const scrollContainerRef"));
    assert.doesNotMatch(dragCancel, /restoreDraggedTask/);
    assert.match(realtime, /deferredTaskId/);
    assert.match(schema, /projectWorkflowColumns/);
    assert.match(schema, /workflowColumnId/);
    assert.match(migration, /project_workflow_columns/);
    assert.match(migration, /workflow_column_id/);
    assert.match(legacyBackfill, /custom_workflow/);
    assert.match(legacyBackfill, /project_workflow_columns/);
});
