import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

test('optimization 1: MessageAttentionProvider patches cached inbox directly from realtime payload without HTTP fetch', () => {
    const file = readFileSync(
        resolve(ROOT, 'src/components/providers/MessageAttentionProvider.tsx'),
        'utf8',
    );

    assert.match(
        file,
        /getCachedInboxConversation\(queryClient,\s*conversationId\)/,
        'Must check existing cached conversation before scheduling HTTP fetch',
    );
    assert.match(
        file,
        /upsertInboxConversation\(queryClient,\s*patched\)/,
        'Must patch cached conversation in memory using realtime payload fields',
    );
});
test('optimization 2: notifications are non-blocking background tasks in collaboration and reactions', () => {
    const collabFile = readFileSync(
        resolve(ROOT, 'src/app/actions/messaging/collaboration.ts'),
        'utf8',
    );
    assert.match(
        collabFile,
        /void emitMessageBurstNotifications\({\s*recipients/s,
        'Structured messaging must not await emitMessageBurstNotifications on critical HTTP response path',
    );

    const featuresFile = readFileSync(
        resolve(ROOT, 'src/app/actions/messaging/features.ts'),
        'utf8',
    );
    assert.match(
        featuresFile,
        /void emitMessageReactionNotification\(pendingNotification\)\.catch/,
        'Reaction notification must be dispatched non-blocking outside the advisory lock transaction',
    );
});
test('optimization 3: useMessagesV2Realtime multiplexes message_work_links onto the active conversation channel', () => {
    const realtimeFile = readFileSync(
        resolve(ROOT, 'src/hooks/useMessagesV2Realtime.ts'),
        'utf8',
    );
    assert.match(
        realtimeFile,
        /table:\s*'message_work_links',\s*filter:\s*`source_conversation_id=eq\.\${activeConversationId}`/,
        'Active conversation channel must multiplex message_work_links table bindings',
    );

    const workLinksFile = readFileSync(
        resolve(ROOT, 'src/hooks/useMessageWorkLinks.ts'),
        'utf8',
    );
    assert.doesNotMatch(
        workLinksFile,
        /subscribeActiveResource/,
        'useMessageWorkLinks must not spin up a duplicate realtime channel',
    );
});

test('optimization 4: MessageBubbleV2 extracts lazy link preview and performs semantic memo comparison', () => {
    const bubbleFile = readFileSync(
        resolve(ROOT, 'src/components/chat/v2/MessageBubbleV2.tsx'),
        'utf8',
    );

    assert.match(
        bubbleFile,
        /const MessageLazyLinkPreview = React\.memo\(function MessageLazyLinkPreview/,
        'Must declare dedicated MessageLazyLinkPreview component to isolate useLinkPreview hook mounting',
    );
    assert.match(
        bubbleFile,
        /{firstUrl \? \(\s*<MessageLazyLinkPreview/s,
        'Must only mount MessageLazyLinkPreview when firstUrl is present',
    );
    assert.match(
        bubbleFile,
        /prevMeta\?\.deliveryState !== nextMeta\?\.deliveryState/,
        'areMessageBubblePropsEqual must compare visual presentation fields instead of metadata reference identity',
    );
});

test('optimization 5: messagesV2UiStore exports batchUpsertMessageAttention and useMessageAttentionState batches mutations', () => {
    const storeFile = readFileSync(
        resolve(ROOT, 'src/stores/messagesV2UiStore.ts'),
        'utf8',
    );
    assert.match(
        storeFile,
        /batchUpsertMessageAttention:\s*\(attentions\)/,
        'Store must provide atomic batchUpsertMessageAttention method',
    );

    const hookFile = readFileSync(
        resolve(ROOT, 'src/hooks/useMessageAttentionState.ts'),
        'utf8',
    );
    assert.match(
        hookFile,
        /batchUpsertMessageAttention\(toUpsert\)/,
        'useMessageAttentionState must batch attention updates into a single store update',
    );
});

test('optimization 6: attachment proxy route expands rate limit and includes stale-while-revalidate headers', () => {
    const routeFile = readFileSync(
        resolve(ROOT, 'src/app/api/v1/messages/attachments/[attachmentId]/route.ts'),
        'utf8',
    );
    assert.match(
        routeFile,
        /enforceRouteLimit\(request,\s*"api:v1:messages:attachments:get",\s*600,\s*60\)/,
        'Attachment proxy rate limit must be at least 600 requests per minute',
    );
    assert.match(
        routeFile,
        /"Cache-Control":\s*"private,\s*max-age=300,\s*stale-while-revalidate=60"/,
        'Attachment redirect response must set Cache-Control with stale-while-revalidate',
    );
});

test('optimization 7: pruneOldMessageReceipts cleans up receipts targeting deliveredAt and readAt', () => {
    const featuresFile = readFileSync(
        resolve(ROOT, 'src/app/actions/messaging/features.ts'),
        'utf8',
    );
    assert.match(
        featuresFile,
        /export async function pruneOldMessageReceipts/,
        'Must export pruneOldMessageReceipts retention helper',
    );
    assert.match(
        featuresFile,
        /db\.delete\(messageDeliveryReceipts\)\.where\(lt\(messageDeliveryReceipts\.deliveredAt,\s*cutoff\)\)/,
        'Delivery receipts deletion must target deliveredAt column',
    );
    assert.match(
        featuresFile,
        /db\.delete\(messageReadReceipts\)\.where\(lt\(messageReadReceipts\.readAt,\s*cutoff\)\)/,
        'Read receipts deletion must target readAt column',
    );
});

test('optimization 8: schema index pruning removes redundant B-tree and GIN indexes', () => {
    const schemaFile = readFileSync(
        resolve(ROOT, 'src/lib/db/schema/index.ts'),
        'utf8',
    );
    assert.doesNotMatch(
        schemaFile,
        /userIdx:\s*index\("conversation_participants_user_idx"\)/,
        'conversation_participants must not have redundant userIdx',
    );
    assert.doesNotMatch(
        schemaFile,
        /conversationIdx:\s*index\("conversation_participants_conversation_idx"\)/,
        'conversation_participants must not have redundant conversationIdx',
    );
    assert.doesNotMatch(
        schemaFile,
        /senderIdx:\s*index\("messages_sender_idx"\)/,
        'messages must not have redundant senderIdx',
    );
    assert.doesNotMatch(
        schemaFile,
        /replyIdx:\s*index\("messages_reply_idx"\)/,
        'messages must not have redundant replyIdx',
    );
    assert.doesNotMatch(
        schemaFile,
        /userLowIdx:\s*index\("dm_pairs_user_low_idx"\)/,
        'dm_pairs must not have redundant userLowIdx',
    );
});

test('optimization 9: searchMessages removes unindexed ILIKE clauses that break GIN index scans', () => {
    const allFile = readFileSync(
        resolve(ROOT, 'src/app/actions/messaging/_all.ts'),
        'utf8',
    );
    assert.doesNotMatch(
        allFile,
        /\$\{messages\.content\}\s*ILIKE\s*\$\{searchPattern\}/,
        'searchMessages must not perform unindexed ILIKE on messages.content',
    );
    assert.match(
        allFile,
        /\$\{messages\.searchDocument\}\s*@@\s*websearch_to_tsquery/,
        'searchMessages must rely on searchDocument tsvector GIN index',
    );
});

test('optimization 10: mergeMessageCollections performs single-pass merge across multiple collections', async () => {
    const { mergeMessageCollections } = await import('@/lib/messages/utils');
    const page1 = [
        {
            id: 'm1',
            conversationId: 'c1',
            content: 'First message',
            createdAt: new Date('2026-01-01T10:00:00Z'),
            type: 'text' as const,
            metadata: {},
            senderId: 'u1',
            replyToMessageId: null,
            clientMessageId: 'cli-1',
            editedAt: null,
            deletedAt: null,
            sender: { id: 'u1', username: 'alice', fullName: 'Alice', avatarUrl: null },
        },
    ];
    const page2 = [
        {
            id: 'm2',
            conversationId: 'c1',
            content: 'Second message',
            createdAt: new Date('2026-01-01T10:05:00Z'),
            type: 'text' as const,
            metadata: {},
            senderId: 'u2',
            replyToMessageId: null,
            clientMessageId: 'cli-2',
            editedAt: null,
            deletedAt: null,
            sender: { id: 'u2', username: 'bob', fullName: 'Bob', avatarUrl: null },
        },
    ];

    const merged = mergeMessageCollections(page1, page2);
    assert.equal(merged.length, 2, 'Must merge both collections without duplicates');
    assert.equal(merged[0].id, 'm1', 'Earliest message must come first');
    assert.equal(merged[1].id, 'm2', 'Later message must follow');
});

test('optimization 11: pixelsHaveTransparency fast-path correctly detects transparent pixels', async () => {
    const { pixelsHaveTransparency } = await import('@/lib/messages/image-compression');
    // 64 pixels (256 bytes), all opaque
    const opaque = new Uint8ClampedArray(256).fill(255);
    assert.equal(pixelsHaveTransparency(opaque), false, 'Opaque buffer must return false');

    // Buffer with a transparent pixel in the body
    const withAlpha = new Uint8ClampedArray(256).fill(255);
    withAlpha[67] = 0; // alpha channel of pixel 16 (stride test)
    assert.equal(pixelsHaveTransparency(withAlpha), true, 'Buffer with alpha must return true');
});

test('optimization 12: useMessageReceiptBuffer bounds in-memory receipts at 2,000 items', () => {
    const bufferFile = readFileSync(
        resolve(ROOT, 'src/hooks/useMessageReceiptBuffer.ts'),
        'utf8',
    );
    assert.match(
        bufferFile,
        /const MAX_GLOBAL_RECEIPTS = 2_000;/,
        'Must cap global receipts at 2,000 items',
    );
    assert.match(
        bufferFile,
        /globalFlushedReceipts\.delete\(oldest\)/,
        'Must evict oldest receipt when capacity is reached',
    );
});

test('optimization 13: renderTextWithMentions fast-paths plain text without regex parsing', () => {
    const renderFile = readFileSync(
        resolve(ROOT, 'src/components/chat/v2/message-rendering.tsx'),
        'utf8',
    );
    assert.match(
        renderFile,
        /if\s*\(!text\.includes\('`'\)\s*&&\s*!text\.includes\('@'\)\s*&&\s*!text\.includes\('http'\)\s*&&\s*!text\.includes\('www\.'\)\)\s*{\s*return text;\s*}/,
        'Must fast-path plain text strings without running regex split',
    );
});

test('optimization 14: MediaViewerModal is dynamically loaded on demand', () => {
    const attFile = readFileSync(
        resolve(ROOT, 'src/components/chat/v2/message-attachments.tsx'),
        'utf8',
    );
    assert.match(
        attFile,
        /const MediaViewerModal = dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/ui\/media-viewer'\)/,
        'MediaViewerModal must be loaded dynamically with next/dynamic',
    );
});

test('optimization 15: MessagesWorkspaceV2 eliminated use-debounce dependency', () => {
    const wsFile = readFileSync(
        resolve(ROOT, 'src/components/chat/v2/MessagesWorkspaceV2.tsx'),
        'utf8',
    );
    assert.doesNotMatch(
        wsFile,
        /from 'use-debounce'/,
        'MessagesWorkspaceV2 must not depend on external use-debounce package',
    );
});

test('optimization 16: ApplicationsListV2 eliminated 60-second periodic full-list re-render timer', () => {
    const appListFile = readFileSync(
        resolve(ROOT, 'src/components/chat/v2/ApplicationsListV2.tsx'),
        'utf8',
    );
    assert.doesNotMatch(
        appListFile,
        /nowMinute/,
        'ApplicationsListV2 must not use nowMinute periodic re-render state',
    );
});

test('optimization 17: useDeliveryAcks wrapper eliminated and MessageThreadV2 calls buffer directly', () => {
    const threadFile = readFileSync(
        resolve(ROOT, 'src/components/chat/v2/MessageThreadV2.tsx'),
        'utf8',
    );
    assert.match(
        threadFile,
        /import \{ useMessageReceiptBuffer \} from '@\/hooks\/useMessageReceiptBuffer';/,
        'MessageThreadV2 must import useMessageReceiptBuffer directly',
    );
    assert.doesNotMatch(
        threadFile,
        /useDeliveryAcks/,
        'MessageThreadV2 must not reference useDeliveryAcks',
    );
});

test('optimization 18: detectCodeLanguage limits sample scanning to 1,500 characters', () => {
    const codeFile = readFileSync(
        resolve(ROOT, 'src/lib/messages/code-snippets.ts'),
        'utf8',
    );
    assert.match(
        codeFile,
        /const sample = normalizeSnippetContent\(content\)\.slice\(0,\s*1500\);/,
        'detectCodeLanguage must slice sample to 1500 characters for high-speed regex scan',
    );
});

test('optimization 19: getConversations removed runInFlightDeduped wrapper', () => {
    const allFile = readFileSync(
        resolve(ROOT, 'src/app/actions/messaging/_all.ts'),
        'utf8',
    );
    assert.doesNotMatch(
        allFile,
        /messages:conversations:\$\{user\.id\}/,
        'getConversations must not allocate dedupe keys on flight dedupe map',
    );
});

test('optimization 20: useTypingChannel throttles typing presence broadcasts by 2.5 seconds', () => {
    const typingFile = readFileSync(
        resolve(ROOT, 'src/hooks/useTypingChannel.ts'),
        'utf8',
    );
    assert.match(
        typingFile,
        /now - lastSentRef\.current < 2500/,
        'useTypingChannel must throttle isTyping: true broadcasts by 2.5 seconds',
    );
});
