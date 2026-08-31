import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("global message attention is sourced from conversation unread state, not the bell tray", () => {
    const header = source("src/components/layout/header/TopNav.tsx");
    const popup = source("src/components/chat/v2/ChatPopupV2.tsx");
    const provider = source("src/components/providers/MessageAttentionProvider.tsx");
    const notifications = source("src/app/actions/notifications.ts");

    assert.match(header, /useMessageAttention/);
    assert.match(header, /messageAttention\.hasUnreadMessages/);
    assert.doesNotMatch(header, /item\.href === ROUTES\.MESSAGES\)[\s\S]{0,180}notifications\.unreadCount/);
    assert.match(popup, /useMessageAttention/);
    assert.match(popup, /unreadCount} unread messages/);
    assert.match(provider, /getUnreadCount/);
    assert.match(provider, /subscribeMessagingNotifications/);
    assert.match(provider, /useMemo\(\(\) => queryKeys\.messages\.v2\.unread\(\), \[\]\)/);
    assert.match(provider, /getConversationSummariesV2/);
    assert.match(provider, /upsertInboxConversation/);
    assert.doesNotMatch(notifications, /syncMessageBurstConversationReads/);
});

test("the global runtime owns participant subscriptions while the inbox reuses them", () => {
    const realtime = source("src/components/providers/RealtimeProvider.tsx");
    const inboxRealtime = source("src/hooks/useMessagesV2Realtime.ts");
    const inbox = source("src/hooks/useMessagesV2.ts");

    assert.match(realtime, /subscribeMessagingNotifications: registerMessagingNotificationListener/);
    assert.match(realtime, /subscribeMessagingNotificationsChannel/);
    assert.match(inboxRealtime, /const \{ isMessagingConnected, messagingStatus, subscribeMessagingNotifications \} = useRealtime\(\)/);
    assert.doesNotMatch(inboxRealtime, /channel = subscribeMessagingNotifications\(/);
    assert.match(inbox, /setQueryData\([\s\S]*\{ updatedAt: 0 \}/);
});
