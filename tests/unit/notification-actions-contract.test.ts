import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('legacy bulk-read support remains defensive but is removed from the tray workflow', () => {
    const actions = readProjectFile('src/app/actions/notifications.ts');
    const hook = readProjectFile('src/hooks/useNotifications.ts');
    const tray = readProjectFile('src/components/layout/header/NotificationPreview.tsx');

    assert.match(actions, /const readAt = await markAllNotificationsRead\(user\.id, db\)/);
    assert.match(actions, /readAt:\s*readAt\?\.toISOString\(\) \?\? null/);
    assert.doesNotMatch(actions, /readAt:\s*readAt\.toISOString\(\)/);
    assert.doesNotMatch(hook, /markAllNotificationsReadAction/);
    assert.doesNotMatch(tray, /Mark all read/);
});

test('tray reviews are staged until close, then committed as seen without consuming linked content', () => {
    const actions = readProjectFile('src/app/actions/notifications.ts');
    const service = readProjectFile('src/lib/notifications/service.ts');
    const hook = readProjectFile('src/hooks/useNotifications.ts');
    const row = readProjectFile('src/components/notifications/NotificationRow.tsx');

    assert.match(actions, /export async function markNotificationsSeenAction\(notificationIds: string\[\]\)/);
    assert.match(actions, /markNotificationsSeen\(user\.id, notificationIds, db\)/);
    assert.match(service, /export async function markNotificationsSeen\(/);
    assert.match(service, /\.slice\(0, 50\)/);
    assert.match(hook, /viewedNotificationIdsRef/);
    assert.match(hook, /stageViewedNotifications/);
    assert.match(hook, /commitViewedNotifications/);
    assert.match(hook, /markNotificationsSeenAction\(notificationIds\)/);
    assert.match(hook, /markNotificationsSeenInInfiniteData/);
    assert.match(row, /setTimeout\(markViewed, QUALIFIED_VIEW_MS\)/);
    assert.doesNotMatch(row, /markNotificationsReadAction/);
    assert.doesNotMatch(hook, /markNotificationsReadAction/);
});

test('notification ordering is based on source activity and actor previews are canonicalized once per fan-out', () => {
    const schema = readProjectFile('src/lib/db/schema/index.ts');
    const service = readProjectFile('src/lib/notifications/service.ts');
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');
    const migration = readProjectFile('drizzle/0128_notification_activity_state_contract.sql');

    assert.match(schema, /activityAt:\s*timestamp\(["']activity_at["']/);
    assert.match(service, /orderBy\(desc\(userNotifications\.activityAt\), desc\(userNotifications\.id\)\)/);
    assert.match(service, /activityAt: now/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "activity_at"/);
    assert.match(fanout, /async function hydrateActorPreviews/);
    assert.match(fanout, /inArray\(profiles\.id, actorIds\)/);
    assert.match(fanout, /writes = await hydrateActorPreviews/);
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
    assert.match(messageEmitter, /body: null/);
    assert.doesNotMatch(messageEmitter, /previewText/);
    assert.match(messageEmitter, /sourceMessageId: params\.sourceMessageId/);
    assert.match(messagingActions, /sourceMessageId: newMessage!\.id/);

    const messageNotificationCalls = messagingActions.match(/emitMessageBurstNotifications\(\{/g) ?? [];
    assert.equal(messageNotificationCalls.length, 1);
});

test('chat-backed workflow notifications retain their source message for reply-style navigation', () => {
    const emitters = readProjectFile('src/lib/notifications/emitters.ts');
    const collaboration = readProjectFile('src/app/actions/messaging/collaboration.ts');

    assert.match(emitters, /sourceMessageId: string;/);
    assert.match(emitters, /href: buildMessageSourceHref\(params\.conversationId, params\.sourceMessageId\)/);
    assert.match(emitters, /sourceMessageId: params\.sourceMessageId/);
    assert.match(collaboration, /href: buildMessageSourceHref\(conversationId, result\.messageRow\.id\)/);
    assert.match(collaboration, /href: buildMessageSourceHref\(workflow\.conversationId, workflow\.messageId\)/);
});

test('message deletion updates only the notification sourced from that message', () => {
    const service = readProjectFile('src/lib/notifications/service.ts');
    const messaging = readProjectFile('src/app/actions/messaging/_all.ts');

    assert.match(service, /export async function markMessageBurstSourceDeleted/);
    assert.match(service, /entityRefs} ->> 'sourceMessageId' = \$\{sourceMessageId\}/);
    assert.match(service, /title: 'This message was deleted'/);
    assert.match(messaging, /await markMessageBurstSourceDeleted\(/);
});

test('message notification delivery does not own canonical chat unread state', () => {
    const hook = readProjectFile('src/hooks/useNotifications.ts');
    const provider = readProjectFile('src/components/providers/MessageAttentionProvider.tsx');

    assert.doesNotMatch(hook, /invalidateMessageAttentionQueries|upsertMessageAttention/);
    assert.match(provider, /getUnreadCount/);
    assert.match(provider, /subscribeMessagingNotifications/);
});

test('message notification previews are redacted from existing rows', () => {
    const migration = readProjectFile('drizzle/0132_message_notification_preview_redaction.sql');

    assert.match(migration, /UPDATE public\.user_notifications/);
    assert.match(migration, /SET body = NULL/);
    assert.match(migration, /WHERE kind = 'message_burst' AND body IS NOT NULL/);
});

test('all source notification writes persist inline and only use the worker to retry failed writes', () => {
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');

    assert.match(fanout, /import \{ db \} from ["']@\/lib\/db["']/);
    assert.match(fanout, /source-action:inline/);
    assert.match(fanout, /deliverNotificationFanout\([\s\S]*executor \?\? db/);
    assert.match(fanout, /source-action:inline-retry/);
    assert.match(fanout, /const failedWrites = deliveries\.flatMap/);
});

test('profile enrichment failure does not prevent durable notification writes', () => {
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');

    assert.match(fanout, /let writes = normalizedWrites;/);
    assert.match(fanout, /notifications\.actor_preview_hydration_failed/);
    assert.match(fanout, /writes = await hydrateActorPreviews/);
});

test('every user-visible project notification preference has a concrete source trigger', () => {
    const policy = readProjectFile('src/lib/notifications/project-policy.ts');
    const sourceFiles = [
        'src/app/actions/project/_all.ts',
        'src/app/actions/task.ts',
        'src/app/actions/task-comment.ts',
        'src/app/actions/project/doc.ts',
        'src/app/actions/project/updates.ts',
        'src/app/actions/account.ts',
        'src/app/actions/files/mutations.ts',
        'src/app/actions/files/versions.ts',
        'src/app/actions/applications/internal.ts',
        'src/app/actions/messaging/collaboration.ts',
        'src/lib/notifications/task-file.ts',
        'src/lib/notifications/task-comment-mention.ts',
    ].map(readProjectFile).join('\n');
    const visibleEntries = Array.from(policy.matchAll(/^    "([^"]+)": E\(\{[\s\S]*?\n    \}\),/gm))
        .filter((entry) => /visible: true/.test(entry[0]));

    assert.ok(visibleEntries.length > 0);
    for (const entry of visibleEntries) {
        const key = entry[1]!;
        assert.match(sourceFiles, new RegExp(`["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
    }
});

test('direct task-comment replies respect the same mention preference as project event replies', () => {
    const emitters = readProjectFile('src/lib/notifications/emitters.ts');
    const replyEmitter = emitters.slice(
        emitters.indexOf('export async function emitTaskCommentReplyNotification'),
        emitters.indexOf('export async function emitTaskFileNotification'),
    );

    assert.match(replyEmitter, /category: "mentions"/);
});
