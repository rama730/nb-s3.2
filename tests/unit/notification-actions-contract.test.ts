import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('bulk notification actions handle missing timestamps without throwing', () => {
    const actions = readProjectFile('src/app/actions/notifications.ts');
    const hook = readProjectFile('src/hooks/useNotifications.ts');

    assert.match(actions, /const readAt = await markAllNotificationsRead\(user\.id, db\)/);
    assert.match(actions, /readAt:\s*readAt\?\.toISOString\(\) \?\? null/);
    assert.doesNotMatch(actions, /readAt:\s*readAt\.toISOString\(\)/);
    assert.match(actions, /const seenAt = await markNotificationsSeen\(user\.id, db\)/);
    assert.match(actions, /seenAt:\s*seenAt\?\.toISOString\(\) \?\? null/);
    assert.doesNotMatch(actions, /seenAt:\s*seenAt\.toISOString\(\)/);

    assert.match(hook, /if \(!result\.success\) \{/);
    assert.match(hook, /readAt:\s*result\.readAt \?\? null/);
    assert.match(hook, /if \(result\.readAt\) \{[\s\S]*markAllNotificationsReadInInfiniteData\(existing, result\.readAt!\)/);
});

test('message notifications are delivered inline when no transaction executor is supplied', () => {
    const emitters = readProjectFile('src/lib/notifications/emitters.ts');
    const messagingActions = readProjectFile('src/app/actions/messaging/_all.ts');
    const messageEmitter = emitters.slice(
        emitters.indexOf('export async function emitMessageBurstNotifications'),
        emitters.indexOf('export async function emitWorkflowAssignedNotification'),
    );

    assert.match(emitters, /import \{ db \} from ["']@\/lib\/db["']/);
    assert.match(messageEmitter, /return emitNotificationWrites\(writes, executor \?\? db\)/);
    assert.doesNotMatch(messageEmitter, /emitNotificationWrites\(writes, executor\)/);

    const messageNotificationCalls = messagingActions.match(/emitMessageBurstNotifications\(\{/g) ?? [];
    assert.equal(messageNotificationCalls.length, 2);
});

test('notification fanout falls back to inline delivery when event enqueue fails', () => {
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');

    assert.match(fanout, /import \{ db \} from ["']@\/lib\/db["']/);
    assert.match(fanout, /catch \(error\) \{[\s\S]*deliverNotificationFanout\(\{[\s\S]*inline-fallback[\s\S]*\}, db\)/);
    assert.match(fanout, /mode: "inline-fallback"/);
    assert.match(fanout, /notifications\.fanout_enqueue_failed/);
    assert.match(fanout, /inline fallback threw/);
});
