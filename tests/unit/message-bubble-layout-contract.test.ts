import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function cssBlock(css: string, selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escapedSelector}\\s*\\{`).exec(css);
    if (!match) return '';

    const openingBraceIndex = match.index + match[0].lastIndexOf('{');
    let depth = 0;

    for (let index = openingBraceIndex; index < css.length; index += 1) {
        const char = css[index];
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char !== '}') continue;

        depth -= 1;
        if (depth === 0) {
            return css.slice(openingBraceIndex + 1, index);
        }
    }

    return '';
}

test('message bubbles keep actions out of text layout and avoid scroll flicker animation', () => {
    const bubble = readProjectFile('src/components/chat/v2/MessageBubbleV2.tsx');
    const css = readProjectFile('src/app/globals.css');

    const bubbleShell = cssBlock(css, '.msg-bubble-shell');
    const actionRail = cssBlock(css, '.msg-action-rail');

    assert.match(bubble, /msg-bubble-stack/);
    assert.match(bubble, /msg-bubble-lane/);
    assert.match(bubble, /msg-action-rail/);
    assert.doesNotMatch(bubble, /left-full|right-full/);
    assert.match(css, /\.msg-message-row,\s*\.msg-bubble-lane\s*\{[\s\S]*?overflow-x:\s*clip/);
    assert.match(actionRail, /flex:\s*0 0 var\(--msg-action-rail-width\)/);
    assert.doesNotMatch(bubbleShell, /animation\s*:/);
});

test('message text wraps by words first and only breaks unbroken long content', () => {
    const rendering = readProjectFile('src/components/chat/v2/message-rendering.tsx');
    const css = readProjectFile('src/app/globals.css');

    const bubbleShell = cssBlock(css, '.msg-bubble-shell');
    const messageText = cssBlock(css, '.msg-message-text');

    assert.match(css, /\.msg-bubble-stack\[data-surface="popup"\]/);
    assert.match(rendering, /msg-message-text leading-relaxed/);
    assert.match(bubbleShell, /overflow-wrap:\s*break-word/);
    assert.match(bubbleShell, /word-break:\s*normal/);
    assert.match(css, /\.msg-bubble-shell\[data-rich="true"\]/);
    assert.match(messageText, /white-space:\s*pre-wrap/);
    assert.match(messageText, /overflow-wrap:\s*break-word/);
    assert.match(messageText, /word-break:\s*normal/);
});

test('rich message content is bounded inside popup message lanes', () => {
    const bubble = readProjectFile('src/components/chat/v2/MessageBubbleV2.tsx');
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');
    const linkPreview = readProjectFile('src/components/chat/v2/LinkPreviewCard.tsx');
    const structuredCard = readProjectFile('src/components/chat/v2/StructuredMessageCardV2.tsx');
    const rendering = readProjectFile('src/components/chat/v2/message-rendering.tsx');
    const chips = readProjectFile('src/components/chat/v2/MessageContextChipRowV2.tsx');
    const reactionBar = readProjectFile('src/components/chat/v2/ReactionQuickBar.tsx');
    const reactionPills = readProjectFile('src/components/chat/v2/ReactionPillRow.tsx');
    const css = readProjectFile('src/app/globals.css');

    const richContent = cssBlock(css, '.msg-rich-content');

    assert.match(thread, /overflowX:\s*'hidden'/);
    assert.match(thread, /msg-message-row/);
    assert.match(bubble, /data-rich=\{hasRichContent \? 'true' : undefined\}/);
    assert.match(bubble, /align=\{isOwn \? 'end' : 'start'\}/);
    assert.match(bubble, /<ReactionPillRow[\s\S]*align=\{isOwn \? 'end' : 'start'\}/);
    assert.match(linkPreview, /msg-rich-content/);
    assert.match(linkPreview, /w-full max-w-full min-w-0/);
    assert.match(linkPreview, /sizes=/);
    assert.match(structuredCard, /msg-rich-content/);
    assert.match(structuredCard, /w-full max-w-full min-w-0/);
    assert.match(rendering, /msg-rich-content/);
    assert.match(rendering, /w-full max-w-full min-w-0 gap-1/);
    assert.match(chips, /min-w-0 max-w-full/);
    assert.match(reactionBar, /msg-reaction-quick-bar/);
    assert.match(cssBlock(css, '.msg-reaction-quick-bar'), /width:\s*max-content/);
    assert.match(cssBlock(css, '.msg-reaction-quick-bar'), /max-width:\s*min\(18rem, calc\(100vw - 2rem\)\)/);
    assert.match(reactionPills, /msg-reaction-row/);
    assert.match(reactionPills, /w-full min-w-0 max-w-full flex-wrap/);
    assert.match(richContent, /overflow:\s*hidden/);
});

test('message thread opens at the rendered latest item', () => {
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');
    const anchor = readProjectFile('src/hooks/useMessageThreadAnchor.ts');

    assert.match(thread, /GroupedVirtuoso/);
    assert.match(thread, /initialTopMostItemIndex=/);
    assert.match(thread, /index:\s*'LAST'/);
    assert.match(thread, /scrollToLatest\('auto',\s*6\)/);
    assert.match(thread, /startReached=\{\(\)\s*=>\s*\{[\s\S]*requestOlderMessages\(\)/);
    assert.match(thread, /const requestOlderMessages = useCallback/);
    assert.match(thread, /canLoadOlderMessages\(\)/);
    assert.match(thread, /const absoluteIndex = firstItemIndex \+ index/);
    assert.match(thread, /startIndex - firstItemIndex/);
    assert.match(thread, /showAvatar=\{item\.showAvatar\}/);
    assert.match(anchor, /shouldLoadOlderMessages/);
    assert.doesNotMatch(thread, /followOutput=/);
});

test('scrolling date headers are virtualizer-owned and loading has a separate row', () => {
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');
    const items = readProjectFile('src/lib/messages/thread-items.ts');
    const css = readProjectFile('src/app/globals.css');

    assert.match(thread, /OLDER_MESSAGES_PRELOAD_THRESHOLD = 6/);
    assert.match(thread, /startDataIndex <= OLDER_MESSAGES_PRELOAD_THRESHOLD/);
    assert.match(thread, /olderMessagesRequestInFlightRef/);
    assert.match(thread, /groupCounts=\{groupCounts\}/);
    assert.match(thread, /groupContent=\{\(groupIndex\) =>/);
    assert.match(thread, /ThreadDateGroupHeader/);
    assert.match(thread, /groupHeaderKeyByVirtualIndex\.get\(index\) \?\? item\?\.id/);
    assert.match(thread, /keyMap\.set\(firstItemIndex \+ headerIndex, `group-\$\{group\.id\}`\)/);
    assert.match(items, /buildMessageThreadModel/);
    assert.match(items, /buildMessageThreadGroupHeaderIndexes/);
    assert.doesNotMatch(thread, /setStickyDate/);
    assert.doesNotMatch(thread, /StickyDateHeader/);
    assert.match(thread, /Header:\s*\(\) =>[\s\S]*<OlderMessagesLoader \/>/);
    assert.match(thread, /function OlderMessagesLoader\(\)/);
    assert.match(thread, /Loading earlier messages\.\.\./);
    assert.match(thread, /pt-12/);
    assert.match(css, /\.msg-date-group-header/);
});

test('async rich content notifies the single scroll controller', () => {
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');
    const bubble = readProjectFile('src/components/chat/v2/MessageBubbleV2.tsx');
    const rendering = readProjectFile('src/components/chat/v2/message-rendering.tsx');
    const linkPreview = readProjectFile('src/components/chat/v2/LinkPreviewCard.tsx');

    assert.match(thread, /autoscrollToBottom\(\)/);
    assert.match(thread, /onContentLoad=\{handleContentLoad\}/);
    assert.match(bubble, /onContentLoad\?: \(\) => void/);
    assert.match(bubble, /renderedLinkPreview/);
    assert.match(bubble, /loading=\{!linkPreview\}/);
    assert.match(rendering, /onContentLoad\?: \(\) => void/);
    assert.match(rendering, /aspectRatio/);
    assert.match(rendering, /src=\{`\$\{currentAttachment\.url\}#view=FitH&toolbar=0&navpanes=0`\}/);
    assert.match(rendering, /sandbox="allow-scripts allow-same-origin"/);
    assert.match(linkPreview, /loading = false/);
    assert.match(linkPreview, /onLoad=\{onContentLoad\}/);
});

test('realtime keeps optimistic messages until a server message is renderable', () => {
    const realtime = readProjectFile('src/hooks/useMessagesV2Realtime.ts');

    assert.match(realtime, /function removeOutboxItemIfPresent/);
    assert.match(realtime, /if \(!nextMessage\) \{[\s\S]*Keep the optimistic outbox row visible[\s\S]*queueThreadMessageSync\(activeConversationId, payload\);[\s\S]*return;[\s\S]*\}/);
    assert.match(realtime, /if \(payload\.eventType === 'INSERT'\) \{[\s\S]*upsertThreadMessage\(queryClient, activeConversationId, nextMessage\);[\s\S]*removeOutboxItemIfPresent\(nextMessage\.clientMessageId\);[\s\S]*patchConversationLastMessageFromMessage/);
    assert.ok(
        realtime.indexOf('if (!nextMessage)') < realtime.indexOf('removeOutboxItemIfPresent(nextMessage.clientMessageId)'),
        'outbox removal should happen only after direct realtime hydration succeeds',
    );
});

test('realtime reactions refresh viewer-specific state instead of trusting shared metadata', () => {
    const realtime = readProjectFile('src/hooks/useMessagesV2Realtime.ts');
    const features = readProjectFile('src/app/actions/messaging/features.ts');
    const cache = readProjectFile('src/lib/messages/v2-cache.ts');

    assert.match(realtime, /hasRealtimeReactionSummaryChange/);
    assert.match(realtime, /mergeRealtimeMessageMetadata/);
    assert.match(realtime, /preserveReactionSummary:\s*reactionSummaryChanged/);
    assert.match(realtime, /refreshMessageReactionSummary/);
    assert.match(realtime, /getMessageReactions/);
    assert.match(realtime, /withReactionSummaryMetadata/);
    assert.match(features, /toPersistedReactionSummary\(reactionSummary\)/);
    assert.match(cache, /updateThreadData\(queryClient, conversationId, \(page\) => \(\{/);
    assert.match(cache, /messages:\s*page\.messages\.map/);
    assert.match(cache, /pinnedMessages:\s*page\.pinnedMessages\.map/);
});

test('follow-up linked work due labels are rendered in the client timezone', () => {
    const bubble = readProjectFile('src/components/chat/v2/MessageBubbleV2.tsx');
    const linkedWork = readProjectFile('src/lib/messages/linked-work.ts');

    assert.match(bubble, /function getLinkedWorkDisplayLabel/);
    assert.match(bubble, /link\.targetType !== 'follow_up'/);
    assert.match(bubble, /const dueAt = typeof link\.metadata\?\.dueAt === 'string'/);
    assert.match(bubble, /format\(dueDate, 'MMM d'\)/);
    assert.match(bubble, /const label = getLinkedWorkDisplayLabel\(link\)/);
    assert.match(bubble, /title=\{link\.subtitle \?\? label\}/);
    assert.match(linkedWork, /getString\(metadata, "dueDate"\) \?\? getString\(metadata, "dueAt"\)\?\.slice\(0, 10\)/);
});

test('visible unread messages commit a conversation read watermark across lifecycle exits', () => {
    const workspace = readProjectFile('src/components/chat/v2/MessagesWorkspaceV2.tsx');
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');

    assert.match(workspace, /pendingReadWatermarkRef/);
    assert.match(workspace, /commitVisibleThreadReadRef/);
    assert.match(workspace, /handleVisibleReadWatermark/);
    assert.match(workspace, /onVisibleReadWatermark=\{handleVisibleReadWatermark\}/);
    assert.match(workspace, /visibilitychange/);
    assert.match(workspace, /pagehide/);
    assert.match(workspace, /window\.addEventListener\('blur'/);
    assert.match(workspace, /handleCommitThreadRead/);
    assert.match(workspace, /handleCommitThreadRead\(null, \{ ignorePendingWatermark: true \}\)/);
    assert.match(workspace, /hasLoadedReadableMessage/);
    assert.match(workspace, /read_seen_detected/);
    assert.match(workspace, /latestReadableMessageId/);
    assert.doesNotMatch(workspace, /latest-server-message/);
    assert.match(workspace, /const handleCloseConversation = \(\) => \{[\s\S]*handleCommitVisibleThreadRead\(\)/);
    assert.match(workspace, /conversationId !== selectedConversationId[\s\S]*handleCommitVisibleThreadRead\(\)/);
    assert.doesNotMatch(workspace, /READ_COMMIT_DWELL_MS/);
    assert.doesNotMatch(workspace, /readOpenCommitTimerRef/);
    assert.doesNotMatch(workspace, /onComposerEngagement=\{handleCommitVisibleThreadRead\}/);
    assert.match(thread, /onVisibleReadWatermark\?: \(messageId: string\) => void/);
    assert.match(thread, /canonicalUnreadModel/);
    assert.match(thread, /unreadMessageIdSet/);
    assert.match(thread, /useLayoutEffect\(\(\) => \{[\s\S]*unreadMessageIdSetRef\.current = unreadMessageIdSet/);
    assert.match(thread, /IntersectionObserver/);
    assert.match(thread, /intersectionRatio < 0\.25/);
    assert.match(thread, /threshold:\s*\[0\.25,\s*0\.5\]/);
    assert.match(thread, /registerUnreadMessageRow/);
    assert.match(thread, /dataset\.messageId/);
    assert.doesNotMatch(thread, /if \(!node \|\| !unreadMessageIdSetRef\.current\.has\(messageId\)\)/);
    assert.match(thread, /latestVisibleUnreadMessageId/);
    assert.match(thread, /onVisibleReadWatermark\?\.\(latestVisibleUnreadMessageId\)/);
});

test('message unread presentation is removed while read watermark logic stays internal', () => {
    const popup = readProjectFile('src/components/chat/v2/ChatPopupV2.tsx');
    const list = readProjectFile('src/components/chat/v2/ConversationListV2.tsx');
    const groups = readProjectFile('src/components/chat/v2/ProjectGroupsListV2.tsx');
    const thread = readProjectFile('src/components/chat/v2/MessageThreadV2.tsx');
    const fab = readProjectFile('src/components/chat/v2/ScrollToBottomFab.tsx');
    const topNav = readProjectFile('src/components/layout/header/TopNav.tsx');

    assert.doesNotMatch(popup, /useUnreadSummary|useSmoothUnreadCount|unreadBadge/);
    assert.doesNotMatch(list, /useSmoothUnreadCount|activeFilter === 'unread'|>Unread</);
    assert.doesNotMatch(groups, /sortBy.*unread|>Unread</);
    assert.doesNotMatch(thread, /useSmoothUnreadCount|unreadPresentation|UNREAD/);
    assert.doesNotMatch(fab, /unreadBelow|99\+/);
    assert.doesNotMatch(topNav, /useUnreadSummary|MessageIndicator/);
    assert.match(thread, /canonicalUnreadModel/);
    assert.match(thread, /registerUnreadMessageRow/);
});
