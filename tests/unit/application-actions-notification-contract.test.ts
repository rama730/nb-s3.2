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

    assert.match(rejectAction, /trackApplicationEvent\('apply_rejected'/);
    assert.match(rejectAction, /try\s*\{\s*await emitApplicationDecisionNotification\(\{[\s\S]*status:\s*'rejected'/);
    assert.match(rejectAction, /catch \(notificationError\) \{[\s\S]*Failed to emit application decision notification/);
    assert.match(rejectAction, /actorUserId:\s*user\.id/);
    assert.match(rejectAction, /recipientUserId:\s*application\.applicantId/);
    assert.match(rejectAction, /eventKey:\s*traceId/);
    assert.match(rejectAction, /traceId/);

    const notificationCatchStart = rejectAction.indexOf('catch (notificationError)');
    const successStart = rejectAction.indexOf('return toApplicationSuccess', notificationCatchStart);
    assert.notEqual(notificationCatchStart, -1);
    assert.notEqual(successStart, -1);
    assert.ok(notificationCatchStart < successStart, 'notification failure must not bypass the success result');

    const notificationCatchBlock = rejectAction.slice(notificationCatchStart, successStart);
    assert.doesNotMatch(notificationCatchBlock, /\bthrow\b/);
});
