import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractFunction(source: string, functionName: string) {
    const startMarker = `export async function ${functionName}`;
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `${functionName} should exist`);
    const nextFunction = source.indexOf('\nexport async function ', start + startMarker.length);
    return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('reject application decision notifications are best-effort after persistence', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const rejectAction = extractFunction(source, 'rejectApplicationAction');
    const helperStart = source.indexOf('async function enqueueApplicationDecisionBestEffort');
    const helperEnd = source.indexOf('\nasync function ', helperStart + 1);
    const enqueueBestEffort = source.slice(helperStart, helperEnd);

    assert.match(rejectAction, /trackApplicationEvent\('apply_rejected'/);
    assert.match(rejectAction, /await enqueueApplicationDecisionBestEffort\(\{[\s\S]*status:\s*'rejected'/);
    assert.match(rejectAction, /actorUserId:\s*user\.id/);
    assert.match(rejectAction, /traceId/);
    assert.match(enqueueBestEffort, /try\s*\{\s*await enqueueProjectNotificationEvent\(\{/);
    assert.match(enqueueBestEffort, /catch \(notificationError\) \{[\s\S]*Failed to enqueue application decision notification/);

    const notificationStart = rejectAction.indexOf('await enqueueApplicationDecisionBestEffort');
    const successStart = rejectAction.indexOf('return toApplicationSuccess', notificationStart);
    assert.notEqual(notificationStart, -1);
    assert.notEqual(successStart, -1);
    assert.ok(notificationStart < successStart, 'notification enqueue must finish before the success result');
});
