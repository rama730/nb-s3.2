import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('useConversationThread: queries enable immediately without cacheReady state barrier', () => {
    const hooksPath = path.join(process.cwd(), 'src/hooks/useMessagesV2.ts');
    const content = fs.readFileSync(hooksPath, 'utf8');

    // Ensure cacheReady state barrier is removed from useConversationThread
    assert.ok(
        !content.includes('enabled: cacheReady && Boolean(conversationId)'),
        'useConversationThread must not gate useInfiniteQuery behind cacheReady state'
    );
    assert.ok(
        content.includes("enabled: Boolean(conversationId) && !conversationId?.startsWith('draft:')"),
        'useConversationThread must enable immediately when conversationId is present'
    );
    assert.ok(
        !content.includes('enabled: enabled && cacheReady'),
        'useInbox must not gate useInfiniteQuery behind cacheReady state'
    );
});

test('ChatPopupV2: pre-warms bundle and active thread during idle and hover', () => {
    const popupPath = path.join(process.cwd(), 'src/components/chat/v2/ChatPopupV2.tsx');
    const content = fs.readFileSync(popupPath, 'utf8');

    assert.ok(
        content.includes('requestIdleCallback') || content.includes('prewarm'),
        'ChatPopupV2 must pre-warm MessagesWorkspaceV2 bundle during idle time'
    );
    assert.ok(
        content.includes('onMouseEnter={handleLauncherPrewarm}'),
        'Launcher button must pre-warm on mouse enter'
    );
    assert.ok(
        content.includes('onFocus={handleLauncherPrewarm}'),
        'Launcher button must pre-warm on focus'
    );
    assert.ok(
        content.includes('prefetchInfiniteQuery'),
        'ChatPopupV2 must prefetch active conversation thread into memory'
    );
});

test('MessageThreadV2: eliminates O(N) slicing and false EmptyConversation flashes', () => {
    const threadPath = path.join(process.cwd(), 'src/components/chat/v2/MessageThreadV2.tsx');
    const content = fs.readFileSync(threadPath, 'utf8');

    // Ensure O(N) slicing is gone
    assert.ok(
        !content.includes('items.slice(dataIndex + 1).some'),
        'MessageThreadV2 must not slice items array on every rendered item'
    );
    assert.ok(
        content.includes('latestMessageItemId'),
        'MessageThreadV2 must precompute latestMessageItemId for O(1) checks'
    );

    // Ensure EmptyConversation is guarded against isFetchingMore
    assert.ok(
        content.includes('!isLoading && !isFetchingMore && orderedMessages.length === 0'),
        'EmptyConversation must be guarded against active loading/fetching'
    );
});
