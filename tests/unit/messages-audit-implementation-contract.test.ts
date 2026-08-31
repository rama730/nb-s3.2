import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readProjectFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("message receipt buffering is debounced, session-deduplicated, and never flushes during teardown", () => {
  const source = readProjectFile("src/hooks/useMessageReceiptBuffer.ts");
  const deliveryAcks = readProjectFile("src/hooks/useDeliveryAcks.ts");
  const thread = readProjectFile("src/components/chat/v2/MessageThreadV2.tsx");

  assert.match(source, /ReturnType<typeof setTimeout>/);
  assert.match(source, /timerRef\.current = setTimeout/);
  assert.match(source, /flushedRef\.current\.has\(message\.id\)/);
  assert.match(source, /inFlightRef\.current\.has\(message\.id\)/);
  assert.match(source, /const globalInFlightReceipts = new Set<string>\(\)/);
  assert.match(source, /if \(!result\.success\)/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /flushedRef\.current\.clear\(\)/);
  assert.doesNotMatch(source, /void recordReceipts\(ids\)\.catch/);
  assert.match(deliveryAcks, /const DELIVERY_FLUSH_INTERVAL_MS = 120/);
  assert.doesNotMatch(thread, /useMarkMessagesRead|markRead\(visible\)/);
});

test("read-receipt recovery uses the participant watermark without a refetch loop", () => {
  const realtime = readProjectFile("src/hooks/useMessagesV2Realtime.ts");
  const notifications = readProjectFile("src/app/actions/notifications.ts");

  assert.match(realtime, /const participantReadWatermarksRef = useRef\(new Map<string, MessageReadWatermark>\(\)\)/);
  assert.match(realtime, /const applyParticipantReadWatermark = useCallback/);
  assert.match(realtime, /patchThreadMessages\(/);
  assert.match(realtime, /table: 'conversation_participants'/);
  assert.match(realtime, /applyParticipantReadWatermark\(/);
  assert.match(notifications, /await markConversationNotificationsRead\(user\.id, conversationId, db\)/);
  assert.doesNotMatch(
    notifications.slice(notifications.indexOf('export async function markConversationMessageNotificationsReadAction')),
    /syncMessageBurstConversationReads\(\[conversationId\]\)/,
  );
});

test("message workspace uses URL-backed transitions and explicit recovery states", () => {
  const source = readProjectFile("src/components/chat/v2/MessagesWorkspaceV2.tsx");
  const page = readProjectFile("src/app/(main)/messages/page.tsx");

  assert.match(source, /router\.push\(`\/messages\?\$\{params\.toString\(\)\}`\)/);
  assert.match(source, /Conversation unavailable/);
  assert.match(source, /Back to messages/);
  assert.match(source, /new BroadcastChannel\('nb-messages-sync-v1'\)/);
  assert.match(source, /initialReplyToMessageId/);
  assert.match(source, /replyToMessageId/);
  assert.match(page, /resolvedParams\.replyToMessageId/);
  assert.match(page, /resolvedParams\.tab === 'applications'/);
  assert.doesNotMatch(source, /composerBlurHeight|onComposerHeightChange/);
});

test("new-message recipients use the same server eligibility boundary as send", () => {
  const modal = readProjectFile("src/components/chat/v2/NewMessageModalV2.tsx");
  const action = readProjectFile("src/app/actions/messaging/v2.ts");
  const messaging = readProjectFile("src/app/actions/messaging/_all.ts");

  assert.match(modal, /searchMessageRecipientsV2/);
  assert.doesNotMatch(modal, /getAcceptedConnections/);
  assert.match(action, /export async function searchMessageRecipientsV2/);
  assert.match(action, /accepted_connection\.status = 'accepted'/);
  assert.match(action, /\$\{profiles\.messagePrivacy\} = 'everyone'/);
  assert.match(action, /eligible_application\.status = 'pending'/);
  assert.match(action, /blocked_connection\.status = 'blocked'/);
  assert.match(messaging, /privacy\.canSendMessage/);
  assert.match(messaging, /APPLICATION_BANNER_HIDE_AFTER_MS/);
});

test("message data-authority migration closes mutable client access and establishes native invariants", () => {
  const migration = readProjectFile("drizzle/0129_messages_data_authority.sql");

  for (const constraint of [
    "dm_pairs_ordered_users_check",
    "conversation_participants_last_read_message_conversation_fkey",
    "conversation_participants_last_message_conversation_fkey",
    "messages_reply_to_message_conversation_fkey",
    "message_workflow_items_message_conversation_fkey",
    "message_work_links_source_message_conversation_fkey",
    "message_attachments_storage_reference_check",
  ]) {
    assert.match(migration, new RegExp(constraint));
  }
  assert.match(migration, /search_document tsvector[\s\S]*GENERATED ALWAYS AS/);
  assert.match(migration, /to_tsvector\(\s*'simple'/);
  assert.match(migration, /GRANT SELECT ON TABLE/);
  assert.match(migration, /TO authenticated/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE/);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE|TRUNCATE|TRIGGER|REFERENCES)/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER conversation_participants_validate_dm/);
  assert.match(migration, /\(NEW\.created_at, NEW\.id\)/);
});

test("messaging drift is observed without an automatic repair loop", () => {
  const audit = readProjectFile("src/inngest/functions/message-data-integrity-audit.ts");
  const registry = readProjectFile("src/inngest/registry.ts");

  assert.match(audit, /PARTICIPANT_SAMPLE_SIZE = 500/);
  assert.match(audit, /messages\.integrity\.drift/);
  assert.match(audit, /dm_pair_drift_count/);
  assert.match(audit, /expired_upload_count/);
  assert.doesNotMatch(audit, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
  assert.match(registry, /messageDataIntegrityAudit/);
});

test("messaging database integration covers concurrent writes and the authenticated role matrix", () => {
  const integration = readProjectFile("scripts/check-messages-database.ts");

  assert.match(integration, /Refusing to run messaging integration checks against DATABASE_URL/);
  assert.match(integration, /SET LOCAL ROLE/);
  assert.match(integration, /outsider cannot self-join a known conversation/);
  assert.match(integration, /anonymous role cannot read a known message UUID/);
  assert.match(integration, /a late older message cannot replace the current preview/);
  assert.match(integration, /equal-timestamp tuple pagination has no skip or duplicate/);
  assert.match(integration, /cross-conversation reply references are rejected/);
  assert.match(integration, /cross-conversation read watermarks are rejected/);
  assert.match(integration, /cross-conversation workflow references are rejected/);
  assert.match(integration, /a report cannot omit its conversation identity/);
  assert.match(integration, /a concurrent client message identity produces exactly one message/);
  assert.match(integration, /stored unread count matches the authoritative timeline/);
  assert.match(integration, /browser roles cannot mutate identities or own database infrastructure/);
  assert.match(integration, /concurrent workflow resolution has exactly one winner/);
  assert.match(integration, /concurrent attachment claim has exactly one winner/);
  assert.match(integration, /SET CONSTRAINTS ALL IMMEDIATE/);
});

test("thread hydration reuses one authorization scope and runs message reads concurrently", () => {
  const actions = readProjectFile("src/app/actions/messaging/_all.ts");
  const v2 = readProjectFile("src/app/actions/messaging/v2.ts");

  assert.match(actions, /const \[hiddenRows, rows\] = await Promise\.all\(\[/);
  assert.match(actions, /const \[\s*senderProfiles,[\s\S]*receiptRowsPromise,\s*\]\);/);
  assert.match(v2, /runWithMessageThreadReadScope\(\{/);
  assert.match(v2, /\}, \(\) => Promise\.all\(\[\s*getMessages\([\s\S]*getPinnedMessages\(/);
});

test("composer uploads attachments through the authenticated server action", () => {
  const composerAttachments = readProjectFile("src/components/chat/v2/useMessageComposerAttachments.ts");

  assert.match(composerAttachments, /import \{ cancelAttachmentUpload, uploadAttachment \}/);
  assert.match(composerAttachments, /void uploadAttachment\(formData\)/);
  assert.doesNotMatch(composerAttachments, /fetch\(['"]\/api\/v1\/messages\/attachments/);
});

test("database setup requires TLS remotely while supporting isolated localhost verification", () => {
  const source = readProjectFile("scripts/setup-database.ts");

  assert.match(source, /function requiresDatabaseTls/);
  assert.match(source, /hostname !== "localhost"/);
  assert.match(source, /hostname !== "127\.0\.0\.1"/);
  assert.match(source, /hostname !== "::1"/);
  assert.match(source, /requiresDatabaseTls\(DATABASE_URL\) \? "require" : false/);
});

test("conversation preview lifecycle keeps unsent messages as tombstones", () => {
  const migration = readProjectFile("drizzle/0133_message_preview_lifecycle.sql");
  const realtime = readProjectFile("src/hooks/useMessagesV2Realtime.ts");

  assert.match(migration, /WHEN latest\.deleted_at IS NOT NULL THEN 'This message was deleted'/);
  assert.match(migration, /WHEN latest\.deleted_at IS NOT NULL THEN 'deleted'/);
  assert.match(migration, /latest\.reply_to_message_id IS NOT NULL THEN '↩ '/);
  assert.match(migration, /previewKind/);
  assert.match(migration, /DO \$backfill_message_preview_lifecycle\$/);
  assert.match(realtime, /patchConversationLastMessageFromMessage\(queryClient, activeConversationId/);
});

test("reply interactions use direction-aware gestures and retry virtual-list focus after context hydration", () => {
  const bubble = readProjectFile("src/components/chat/v2/MessageBubbleV2.tsx");
  const thread = readProjectFile("src/components/chat/v2/MessageThreadV2.tsx");

  assert.match(bubble, /const replySwipeDirection = isOwn \? 1 : -1/);
  assert.match(bubble, /deltaX \* replySwipeDirection <= 0/);
  assert.match(bubble, /swipeOffsetRef\.current \* replySwipeDirection >= 50/);
  assert.match(bubble, /isOwn \? 'left-3' : 'right-3'/);
  assert.doesNotMatch(bubble, /getReplyFocusLabel/);
  assert.match(bubble, /window\.addEventListener\('scroll', dismissOverlays, true\)/);
  assert.match(bubble, /window\.removeEventListener\('scroll', dismissOverlays, true\)/);
  assert.match(bubble, /isOwn \? "items-end" : "items-start"/);
  assert.match(bubble, /isLast && attachments\.length === 0 && reactionSummary\.length > 0/);
  assert.match(thread, /const pendingFocusMessageIdRef = useRef<string \| null>\(null\)/);
  assert.match(thread, /const isFocusNavigationRef = useRef\(false\)/);
  assert.match(thread, /pendingFocusMessageIdRef\.current = messageId/);
  assert.match(thread, /setHasFocusTopInset\(true\)/);
  assert.match(thread, /min-h-\[min\(38dvh,18rem\)\]/);
  assert.match(thread, /const targetIndex = messageDataIndexById\.get\(focusedMessage\.id\)/);
  assert.doesNotMatch(thread, /const absoluteIndex = firstItemIndex \+ index/);
  assert.match(thread, /align: 'center'/);
  assert.match(thread, /behavior: prefersReducedMotion \? 'auto' : 'smooth'/);
  assert.match(thread, /const scrollToLatest = useCallback\(\(behavior: 'auto' \| 'smooth' = 'smooth'/);
  assert.doesNotMatch(thread, /run\(attempts\);\s+setUnreadBelow\(0\);\s+setIsAtBottom\(true\);/);
  assert.match(thread, /if \(isFocusNavigationRef\.current \|\| hasFocusTarget/);
  assert.match(thread, /useEffect\(\(\) => \{\s+if \(hasFocusTarget\) return;\s+scrollToLatest\('auto'\);/);
  assert.match(thread, /useEffect\(\(\) => \{\s+if \(hasFocusTarget\) return;\s+if \(isLoading \|\| !latestMessage/);
  assert.match(thread, /useEffect\(\(\) => \{\s+if \(hasFocusTarget\) return;\s+setUnreadBelow\(0\);/);
  assert.doesNotMatch(thread, /focusAnimationFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?focusAnimationFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?focusAnimationFrameRef\.current = window\.requestAnimationFrame/);
});

test("message reactions remain compact, accessible, and anchored to the bubble edge", () => {
  const reactionRow = readProjectFile("src/components/chat/v2/ReactionPillRow.tsx");
  const bubble = readProjectFile("src/components/ui/bubble.tsx");
  const messageBubble = readProjectFile("src/components/chat/v2/MessageBubbleV2.tsx");

  assert.match(reactionRow, /const visibleReactions = reactions\.slice\(0, 3\)/);
  assert.match(reactionRow, /role="group"/);
  assert.doesNotMatch(reactionRow, /role="img"/);
  assert.match(reactionRow, /reaction\.count > 1/);
  assert.match(reactionRow, /additionalReactionCount > 0/);
  assert.match(bubble, /bg-background\/95/);
  assert.match(bubble, /bottom-0 translate-y-1\/2/);
  assert.doesNotMatch(messageBubble, /align=\{isOwn \? 'start' : 'end'\}/);
});

test("thread cache hydration never replaces full messages with inbox previews", () => {
  const threadHook = readProjectFile("src/hooks/useMessagesV2.ts");

  assert.match(threadHook, /messages: cachedPage\.messages/);
  assert.match(threadHook, /\{ updatedAt: 0 \}/);
  assert.doesNotMatch(threadHook, /mergeMessages\(cachedPage\.messages, \[inboxSnapshot\.lastMessage\]\)/);
});
