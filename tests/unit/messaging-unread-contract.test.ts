import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractFunction(source: string, functionName: string) {
    const start = source.indexOf(`function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} should exist`);
    const nextFunction = source.indexOf('\nfunction ', start + functionName.length);
    return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('conversation unread reconciliation counts system messages with null sender', () => {
    const reconcile = readProjectFile('src/lib/messages/preview-refresh.ts');
    const migration = readProjectFile('drizzle/0129_messages_data_authority.sql');

    assert.match(reconcile, /nb_reconcile_conversation_participants\(\s*\$\{conversationId\}::uuid,\s*NULL::uuid\s*\)/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION app_private\.nb_reconcile_conversation_participants/);
    assert.match(migration, /unread_message\.sender_id IS DISTINCT FROM target\.user_id/);
    assert.match(migration, /\(unread_message\.created_at, unread_message\.id\) >/);
    assert.match(migration, /target\.last_read_message_id/);
    assert.match(migration, /FROM public\.message_hidden_for_users hidden/);
    assert.match(migration, /unread_message\.deleted_at IS NULL/);
    assert.doesNotMatch(reconcile, /\.select\(\{ count:/);
});

test('mark conversation read returns the reconciled unread count instead of forcing zero', () => {
    const source = readProjectFile('src/app/actions/messaging/_all.ts');
    const markRead = extractFunction(source, 'markConversationAsRead');

    assert.match(markRead, /const result = await db\.transaction\(async \(tx\) =>/);
    assert.match(markRead, /const finalUnreadCount = Number\(row\?\.count \?\? 0\)/);
    assert.match(markRead, /unreadCount: finalUnreadCount/);
    assert.match(markRead, /\.returning\(\{/);
    assert.match(markRead, /updatedMembership/);
    assert.match(markRead, /conversationId,/);
    assert.match(markRead, /serverAppliedAt: new Date\(\)\.toISOString\(\)/);
    assert.match(markRead, /unreadCount: updatedMembership\?\.unreadCount \?\? 0/);
    assert.match(markRead, /lastReadMessageId: updatedMembership\?\.lastReadMessageId \?\? null/);
    assert.match(markRead, /lastReadAt: updatedMembership\?\.lastReadAt \?\? null/);
    assert.match(markRead, /shouldClearNotifications:/);
    assert.match(markRead, /if \(result\.shouldClearNotifications\)/);
    assert.doesNotMatch(markRead, /unreadCount: 0,\n\s*archivedAt: null/);
});

test('mark conversation read never regresses the persisted read watermark', () => {
    const source = readProjectFile('src/app/actions/messaging/_all.ts');
    const markRead = extractFunction(source, 'markConversationAsRead');

    assert.match(source, /function compareReadWatermark/);
    assert.match(source, /return 0;/);
    assert.match(source, /function shouldAdvanceReadWatermark/);
    assert.match(markRead, /lastReadAt: conversationParticipants\.lastReadAt/);
    assert.match(markRead, /orderBy\(desc\(messages\.createdAt\), desc\(messages\.id\)\)/);
    assert.match(markRead, /const shouldAdvanceWatermark = shouldAdvanceReadWatermark/);
    assert.match(markRead, /lastReadAt: nextLastReadAt/);
    assert.match(markRead, /lastReadMessageId: nextLastReadMessageId/);
    assert.match(markRead, /const unreadAfterWatermark = buildUnreadAfterReadWatermarkPredicate\(\n\s*conversationId,\n\s*nextLastReadMessageId,\n\s*nextLastReadAt,/);
    assert.match(markRead, /if \(unreadAfterWatermark\) predicates\.push\(unreadAfterWatermark\)/);
    assert.doesNotMatch(markRead, /gt\(messages\.id, nextLastReadMessageId\)/);
    assert.match(markRead, /if \(watermarkMessage && shouldAdvanceWatermark\)/);
    assert.match(markRead, /if \(!shouldAdvanceWatermark && \(membership\.unreadCount \?\? 0\) === 0\)/);
});

test('mark read mutation rejects server failures and keeps cache in sync with server count', () => {
    const source = readProjectFile('src/hooks/useMessagesV2.ts');
    const markReadStart = source.indexOf('const markRead = useMutation');
    assert.notEqual(markReadStart, -1, 'markRead mutation should exist');
    const muteStart = source.indexOf('const muteConversation = useMutation', markReadStart);
    const markRead = source.slice(markReadStart, muteStart === -1 ? undefined : muteStart);

    assert.match(markRead, /if \(!result\.success\) \{/);
    assert.match(markRead, /throw new Error\(result\.error \|\| 'Failed to mark conversation read'\)/);
    assert.match(markRead, /onMutate: \(params\) =>/);
    assert.match(markRead, /const previousUnreadCount = currentConversation\?\.unreadCount \?\? 0/);
    assert.match(markRead, /const previousLastReadAt = currentConversation\?\.lastReadAt \?\? null/);
    assert.match(markRead, /const optimisticReadMessage = params\.lastReadMessageId/);
    assert.match(markRead, /setPendingReadCommitState\(queryClient, params\.conversationId/);
    assert.match(markRead, /params\.lastReadMessageId === currentConversation\?\.lastMessage\?\.id/);
    assert.match(markRead, /\? Math\.max\(0, previousUnreadCount\)\n\s*: 0/);
    assert.match(markRead, /patchThreadConversation\(queryClient, params\.conversationId, \(conversation\) => \(\{/);
    assert.match(markRead, /lastReadAt: optimisticLastReadAt/);
    assert.match(markRead, /lastReadMessageId: optimisticLastReadMessageId/);
    assert.match(markRead, /patchUnreadSummary\(queryClient, \(count\) => Math\.max\(0, count - optimisticClearedCount\)\)/);
    assert.match(markRead, /onError: \(_error, params, context\) =>/);
    assert.match(markRead, /clearPendingReadCommitState\(queryClient, params\.conversationId, context\?\.requestId\)/);
    assert.match(markRead, /lastReadAt: context\?\.previousLastReadAt/);
    assert.match(markRead, /patchUnreadSummary\(queryClient, \(count\) => count \+ optimisticClearedCount\)/);
    assert.match(markRead, /onError: \(_error, params, context\) =>/);
    assert.match(markRead, /const nextUnreadCount = typeof result\.unreadCount === 'number'/);
    assert.match(markRead, /unreadCount: nextUnreadCount/);
    assert.match(markRead, /lastReadAt: result\.lastReadAt/);
    assert.match(markRead, /lastReadMessageId: result\.lastReadMessageId/);
    assert.match(markRead, /if \(optimisticClearedCount > 0\)/);
    assert.match(markRead, /patchUnreadSummary\(queryClient, \(count\) => count \+ nextUnreadCount\)/);
    assert.match(markRead, /const clearedUnreadCount = Math\.max\(0, previousUnreadCount - nextUnreadCount\)/);
    assert.match(markRead, /if \(nextUnreadCount > previousUnreadCount\)/);
});

test('messages workspace advances only the concrete watermark reported by visible unread rows', () => {
    const source = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');

    assert.doesNotMatch(source, /latest-server-message/);
    assert.match(source, /readCommitInFlightRef/);
    assert.match(source, /queuedReadCommitRef/);
    assert.match(source, /recordMessagesReadWatermark\(\{/);
    assert.match(source, /outcome: 'queued'/);
    assert.match(source, /outcome: 'requested'/);
    assert.match(source, /outcome: 'succeeded'/);
    assert.match(source, /outcome: 'failed'/);
    assert.match(source, /lastReadMessageId: serverMessageId/);
    assert.match(source, /handleCommitThreadRead\(messageId, \{ allowLatestFallback: false \}\)/);
    assert.doesNotMatch(source, /READ_COMMIT_DWELL_MS/);
    assert.doesNotMatch(source, /readOpenCommitTimerRef/);
    assert.doesNotMatch(source, /visibilitychange|pagehide|window\.addEventListener\(['"]blur/);
    assert.match(thread, /IntersectionObserver/);
    assert.match(thread, /document\.visibilityState === 'visible'/);
    assert.equal(
        (thread.match(/onVisibleReadWatermarkRef\.current\?\.\(/g) ?? []).length,
        1,
        'the intersection observer should be the only read-watermark owner',
    );
});

test('active-thread read handling does not duplicate notification or global unread work', () => {
    const workspace = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');
    const realtime = readProjectFile('src/hooks/useMessagesV2Realtime.ts');

    assert.doesNotMatch(workspace, /markConversationMessageNotificationsReadAction/);
    assert.doesNotMatch(realtime, /getUnreadCount/);
    assert.doesNotMatch(realtime, /scheduleUnreadRefresh/);
    assert.doesNotMatch(realtime, /refreshUnreadSummary/);
});

test('ordinary sends use the database trigger and optimistic cache instead of redundant summaries', () => {
    const messaging = readProjectFile('src/app/actions/messaging/_all.ts');
    const v2 = readProjectFile('src/app/actions/messaging/v2.ts');

    assert.match(messaging, /const \[participantMembershipId, conversationRows\] = await Promise\.all/);
    assert.match(messaging, /const \[replyPreview, existing\] = await Promise\.all/);
    assert.match(messaging, /if \(claimedAttachments\.length > 0\) \{\s*await tx\s*\.update\(conversationParticipants\)/s);
    assert.match(v2, /let needsConversationSnapshot = false/);
    assert.match(v2, /const conversation = user && result\.success && needsConversationSnapshot/);
    assert.match(v2, /const needsConversationSnapshot = !params\.conversationId \|\| params\.conversationId\.startsWith\('draft:'\)/);
});

test('linked-work hydration avoids a full-history query while the thread is opening', () => {
    const hook = readProjectFile('src/hooks/useMessageWorkLinks.ts');

    assert.match(hook, /const RECENT_LINKED_WORK_MESSAGE_COUNT = 5/);
    assert.match(hook, /const LINKED_WORK_DEFER_MS = 1_000/);
    assert.match(hook, /\.slice\(-RECENT_LINKED_WORK_MESSAGE_COUNT\)/);
    assert.match(hook, /enabled: isDeferredQueryReady && Boolean\(conversationId\) && normalizedMessageIds\.length > 0/);
});

test('messages workspace gates chat-only runtime work by active tab', () => {
    const workspace = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');
    const realtime = readProjectFile('src/hooks/useMessagesV2Realtime.ts');
    const messagesHook = readProjectFile('src/hooks/useMessagesV2.ts');

    assert.match(workspace, /const isChatsTabActive = activeTab === 'chats'/);
    assert.match(workspace, /const hasActiveConversation = Boolean\(selectedConversationId\)/);
    assert.match(workspace, /const inbox = useInbox\(20, isChatsTabActive, inboxView\)/);
    assert.match(workspace, /enabled: hasActiveConversation \|\| isChatsTabActive/);
    assert.match(workspace, /listVisible: isChatsTabActive/);
    assert.match(workspace, /inbox: isChatsTabActive/);
    assert.match(workspace, /activeThread: hasActiveConversation/);
    assert.doesNotMatch(workspace, /NEXT_PUBLIC_MESSAGES_RENDER_PROFILER/);
    assert.doesNotMatch(workspace, /<Profiler/);

    assert.match(messagesHook, /export function useInbox\(\n\s*limit: number = 20,\n\s*enabled: boolean = true,\n\s*scope: 'active' \| 'archived' = 'active'/);
    assert.match(messagesHook, /if \(!enabled \|\| !user\?\.id\)/);
    assert.match(messagesHook, /enabled: enabled && cacheReady/);

    assert.match(realtime, /type MessagesRealtimeOptions = boolean \| \{/);
    assert.match(realtime, /NEXT_PUBLIC_MESSAGES_REALTIME_TRACE/);
    assert.match(realtime, /const inboxRealtimeEnabled = requestedRealtime\.inbox && realtimeAvailable/);
    assert.match(realtime, /const activeThreadRealtimeEnabled = requestedRealtime\.activeThread && realtimeAvailable/);
    assert.match(realtime, /if \(!inboxRealtimeEnabled \|\| !userId \|\| !realtimeToken\)/);
    assert.match(realtime, /if \(!activeThreadRealtimeEnabled \|\| !activeConversationId \|\| !realtimeToken/);
    assert.match(realtime, /traceMessagesRealtimeChannel\('subscribe'/);
});

test('inbox summaries never seed a thread with their partial last-message snapshot', () => {
    const realtime = readProjectFile('src/hooks/useMessagesV2Realtime.ts');

    assert.match(realtime, /upsertInboxConversation\(queryClient, result\.conversation\)/);
    assert.doesNotMatch(realtime, /upsertThreadMessage\([^;]*conversation\.lastMessage/s);
});
