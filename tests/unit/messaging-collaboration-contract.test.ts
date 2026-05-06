import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractExportedFunction(source: string, functionName: string) {
    const start = source.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} should exist`);
    const nextFunction = source.indexOf('\nexport async function ', start + functionName.length);
    return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('message-to-task conversion creates the task and work link atomically', () => {
    const source = readProjectFile('src/app/actions/messaging/collaboration.ts');
    const convertToTask = extractExportedFunction(source, 'convertMessageToTaskActionV2');

    assert.doesNotMatch(source, /createTaskAction/);
    assert.match(convertToTask, /const taskResult = await db\.transaction\(async \(tx\) => \{/);
    assert.match(convertToTask, /FOR UPDATE/);
    assert.match(convertToTask, /current_task_number/);
    assert.match(convertToTask, /tx\s*\.\s*insert\(tasks\)/);
    assert.match(convertToTask, /upsertMessageWorkLink\(tx,/);
    assert.match(convertToTask, /targetType:\s*'task'/);
    assert.match(convertToTask, /mapMessageWorkLinkToSummary\(taskResult\.link\)/);
    assert.match(convertToTask, /queueCounterRefreshBestEffort/);
    assert.match(convertToTask, /emitTaskAssignedNotification/);
});

test('message follow-up due metadata is timezone-stable on the server', () => {
    const source = readProjectFile('src/app/actions/messaging/collaboration.ts');
    const convertToFollowUp = extractExportedFunction(source, 'convertMessageToFollowUpActionV2');

    assert.doesNotMatch(source, /toLocaleDateString/);
    assert.match(source, /function formatDueDateKey\(date: Date\)[\s\S]*date\.toISOString\(\)\.slice\(0, 10\)/);
    assert.match(convertToFollowUp, /dueAt:\s*dueAt\?\.toISOString\(\) \?\? null/);
    assert.match(convertToFollowUp, /dueDate:\s*dueAt \? formatDueDateKey\(dueAt\) : null/);
    assert.doesNotMatch(convertToFollowUp, /dueLabel:\s*dueAt \?/);
});
