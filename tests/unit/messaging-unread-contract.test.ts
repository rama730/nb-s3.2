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
    const source = readProjectFile('src/app/actions/messaging/_all.ts');
    const reconcile = extractFunction(source, 'reconcileConversationUnreadCounts');

    assert.match(reconcile, /eq\(messages\.conversationId, conversationId\)/);
    assert.match(reconcile, /or\(isNull\(messages\.senderId\), ne\(messages\.senderId, participant\.userId\)\)/);
    assert.match(reconcile, /isNull\(messages\.deletedAt\)/);
    assert.match(reconcile, /lastReadMessageId: conversationParticipants\.lastReadMessageId/);
    assert.match(reconcile, /predicates\.push\(gt\(messages\.createdAt, participant\.lastReadAt\)\)/);
    assert.doesNotMatch(reconcile, /gt\(messages\.id, participant\.lastReadMessageId\)/);
    assert.doesNotMatch(reconcile, /eq\(messages\.createdAt, participant\.lastReadAt\)/);
    assert.doesNotMatch(reconcile, /\n\s*ne\(messages\.senderId, participant\.userId\),/);
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
    assert.match(markRead, /if \(\(updatedMembership\?\.unreadCount \?\? 0\) === 0\)/);
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
    assert.match(markRead, /predicates\.push\(gt\(messages\.createdAt, nextLastReadAt\)\)/);
    assert.doesNotMatch(markRead, /gt\(messages\.id, nextLastReadMessageId\)/);
    assert.match(markRead, /if \(watermarkMessage && shouldAdvanceWatermark\)/);
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
    assert.match(markRead, /const optimisticClearedCount = Math\.max\(0, previousUnreadCount\)/);
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

test('messages workspace commits one concrete loaded read watermark on open', () => {
    const source = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');

    assert.match(source, /const hasLoadedReadableMessage = useMemo/);
    assert.match(source, /thread\.messages\.some\(\(message\) => !message\.deletedAt\)/);
    assert.match(source, /const latestReadableMessageId = useMemo/);
    assert.match(source, /commitOptions\.allowLatestFallback[\s\S]*\? latestReadableMessageId : null/);
    assert.doesNotMatch(source, /latest-server-message/);
    assert.match(source, /readCommitInFlightRef/);
    assert.match(source, /queuedReadCommitRef/);
    assert.match(source, /read_commit_replaced_by_newer/);
    assert.match(source, /read_seen_detected/);
    assert.match(source, /lastReadMessageId: explicitMessageId/);
    assert.match(source, /ignorePendingWatermark/);
    assert.match(source, /handleCommitThreadRead\(null, \{ ignorePendingWatermark: true \}\)/);
    assert.match(source, /const shouldCommitLatestServerWatermark =/);
    assert.match(source, /const shouldCommitLatestServerWatermark =\n\s*hasLoadedReadableMessage;/);
    assert.doesNotMatch(source, /READ_COMMIT_DWELL_MS/);
    assert.doesNotMatch(source, /readOpenCommitTimerRef/);
    assert.doesNotMatch(source, /onComposerEngagement=\{handleCommitVisibleThreadRead\}/);
    assert.doesNotMatch(source, /hasLoadedReadableMessage\n\s*&& !focusMessageId/);
    assert.doesNotMatch(source, /latestUnreadMessageId/);
});
