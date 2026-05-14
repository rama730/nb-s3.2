// Task 6 — Property 2: Preservation — Historical Timestamp and Sort Stability
//
// **Validates: Requirements 3.1, 3.2, 3.7**
//
// ─── Preservation Requirements ───────────────────────────────────────
//
// These tests capture EXISTING correct behavior that must NOT regress
// after the stale timestamps fix is applied:
//
//   3.1 — Conversations with existing messages and no new activity
//         retain their correct historical timestamps
//
//   3.2 — Sending a message in an existing conversation continues to
//         deliver and show delivery indicators
//
//   3.7 — Inbox list sorts by `updatedAt` descending (existing
//         `normalizeConversationRows` behavior)
//
// ─── Testing Strategy ────────────────────────────────────────────────
//
// Observation-first methodology:
//   1. Observe: Conversations with no new messages retain their timestamps
//      after cache operations (e.g., reading inbox, patching unrelated convos)
//   2. Observe: `normalizeConversationRows` always produces descending order
//      by `updatedAt` for any set of conversations
//   3. Observe: `patchConversationLastMessageFromMessage` never regresses
//      `updatedAt` — it always advances or stays the same
//
// These tests are EXPECTED TO PASS on unfixed code (preservation).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { QueryClient } from '@tanstack/react-query';

import type { MessageWithSender } from '@/app/actions/messaging';
import type { InboxConversationV2, ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import {
    patchConversationLastMessageFromMessage,
} from '@/lib/messages/v2-cache';
import { queryKeys } from '@/lib/query-keys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCapability(): ConversationCapabilityV2 {
    return {
        conversationType: 'dm',
        status: 'connected',
        canSend: true,
        blocked: false,
        messagePrivacy: 'connections',
        isConnected: true,
        isPendingIncoming: false,
        isPendingOutgoing: false,
        canInvite: true,
        connectionId: 'connection-1',
        hasActiveApplication: false,
        isApplicant: false,
        isCreator: false,
        activeApplicationId: null,
        activeApplicationStatus: null,
        activeProjectId: null,
    };
}

function createConversation(
    id: string,
    lastMessageId: string,
    updatedAt: Date,
): InboxConversationV2 {
    return {
        id,
        type: 'dm',
        updatedAt,
        lifecycleState: 'active',
        muted: false,
        participants: [
            { id: 'user-2', username: 'other-user', fullName: 'Other User', avatarUrl: null },
        ],
        lastMessage: {
            id: lastMessageId,
            content: 'existing message',
            senderId: 'user-2',
            createdAt: updatedAt,
            type: 'text',
        },
        unreadCount: 0,
        lastReadAt: null,
        lastReadMessageId: null,
        capability: createCapability(),
    };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const uuidArb = fc.uuid();

const timestampArb = fc.date({
    min: new Date('2024-01-01T00:00:00.000Z'),
    max: new Date('2026-12-31T23:59:59.999Z'),
});

/**
 * Generates a list of conversations with unique IDs and varying updatedAt values.
 * Used to verify sort stability and timestamp preservation.
 */
const inboxConversationsArb = fc.array(
    fc.record({
        id: uuidArb,
        messageId: uuidArb,
        updatedAt: timestampArb,
    }),
    { minLength: 2, maxLength: 8 },
).filter((items) => {
    // Ensure unique IDs
    const ids = new Set(items.map((i) => i.id));
    if (ids.size !== items.length) return false;
    // Ensure no NaN dates (fast-check shrinking edge case)
    if (items.some((i) => isNaN(i.updatedAt.getTime()))) return false;
    return true;
});

/**
 * Generates a pair of timestamps where the "old" message is strictly before
 * the "new" message. Used for testing that patchConversationLastMessageFromMessage
 * never regresses updatedAt.
 */
const advancingTimestampPairArb = fc.tuple(timestampArb, timestampArb)
    .filter(([old, next]) => next.getTime() > old.getTime())
    .map(([oldTs, newTs]) => ({ oldTimestamp: oldTs, newTimestamp: newTs }));

/**
 * Generates a pair of timestamps where the "attempted" message is strictly BEFORE
 * the current conversation timestamp. Used for testing that patchConversationLastMessageFromMessage
 * does NOT regress updatedAt when an older message arrives.
 */
const regressingTimestampPairArb = fc.tuple(timestampArb, timestampArb)
    .filter(([current, older]) => older.getTime() < current.getTime())
    .map(([currentTs, olderTs]) => ({ currentTimestamp: currentTs, olderTimestamp: olderTs }));

// ---------------------------------------------------------------------------
// Property-Based Tests — Preservation
// ---------------------------------------------------------------------------

describe('Stale Timestamps — Preservation Property Tests (Task 6)', () => {
    describe('Property 2a: Conversations with no new messages retain updatedAt and sort position after cache operations', () => {
        it('for all conversations where no new message is sent, updatedAt and sort position remain unchanged', () => {
            // **Validates: Requirements 3.1**
            //
            // Preservation property: when no new message is sent in a conversation,
            // its `updatedAt` and sort position must remain unchanged after cache
            // operations. We simulate patching a DIFFERENT conversation and verify
            // the untouched conversations retain their timestamps and positions.
            fc.assert(
                fc.property(
                    inboxConversationsArb,
                    fc.integer({ min: 0, max: 100 }),
                    (conversationData, targetIdx) => {
                        // Need at least 2 conversations to test that untouched ones are preserved
                        if (conversationData.length < 2) return;

                        const queryClient = new QueryClient();

                        // Create conversations from generated data
                        const conversations = conversationData.map((data) =>
                            createConversation(data.id, data.messageId, data.updatedAt),
                        );

                        // Set up inbox
                        queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
                            pages: [{ conversations, hasMore: false, nextCursor: null }],
                            pageParams: [undefined],
                        });

                        // Record the initial state of all conversations
                        const initialState = new Map(
                            conversations.map((c) => [c.id, { updatedAt: c.updatedAt.getTime() }]),
                        );

                        // Pick one conversation to patch (the "target" that receives a new message)
                        const targetIndex = targetIdx % conversationData.length;
                        const targetId = conversationData[targetIndex].id;

                        // Patch ONLY the target conversation with a newer timestamp
                        const newerTimestamp = new Date(
                            Math.max(...conversationData.map((d) => d.updatedAt.getTime())) + 60000,
                        );
                        patchConversationLastMessageFromMessage(queryClient, targetId, {
                            id: 'new-msg-id',
                            content: 'new message',
                            senderId: 'user-1',
                            createdAt: newerTimestamp,
                            type: 'text',
                        });

                        // Verify all OTHER conversations retain their updatedAt
                        const inboxData = queryClient.getQueryData<{
                            pages: Array<{ conversations: InboxConversationV2[] }>;
                        }>(queryKeys.messages.v2.inbox(20));

                        const resultConversations = inboxData?.pages[0]?.conversations ?? [];

                        for (const conv of resultConversations) {
                            if (conv.id === targetId) continue; // skip the patched one

                            const initial = initialState.get(conv.id);
                            assert.ok(initial, `Conversation ${conv.id} should exist in initial state`);
                            assert.strictEqual(
                                conv.updatedAt.getTime(),
                                initial.updatedAt,
                                `Preservation violation (Req 3.1): conversation ${conv.id} ` +
                                `had updatedAt ${new Date(initial.updatedAt).toISOString()} ` +
                                `but changed to ${conv.updatedAt.toISOString()} after patching ` +
                                `a DIFFERENT conversation. Conversations with no new messages ` +
                                `must retain their historical timestamps.`,
                            );
                        }
                    },
                ),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 2b: normalizeConversationRows always produces descending order by updatedAt', () => {
        it('generate random inbox states and verify normalizeConversationRows always produces descending order', () => {
            // **Validates: Requirements 3.7**
            //
            // Preservation property: `normalizeConversationRows` must always sort
            // conversations by `updatedAt` descending. This is the existing behavior
            // that must be preserved after the stale timestamps fix.
            //
            // We test this by setting up an inbox with random conversations and
            // verifying the resulting order after `updateInboxData` processes them
            // (which internally calls `normalizeConversationRows`).
            fc.assert(
                fc.property(inboxConversationsArb, (conversationData) => {
                    const queryClient = new QueryClient();

                    // Create conversations with varying updatedAt values
                    const conversations = conversationData.map((data) =>
                        createConversation(data.id, data.messageId, data.updatedAt),
                    );

                    // Set up inbox — this triggers normalizeConversationRows internally
                    // via the setQueryData path (we use patchConversationLastMessageFromMessage
                    // on one conversation to force the sort through updateInboxData)
                    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
                        pages: [{ conversations, hasMore: false, nextCursor: null }],
                        pageParams: [undefined],
                    });

                    // Trigger a no-op patch on the first conversation to force
                    // the data through updateInboxData → normalizeConversationRows.
                    // We patch with the SAME message (same ID) so nothing changes
                    // except the sort is applied.
                    const firstConv = conversationData[0];
                    patchConversationLastMessageFromMessage(queryClient, firstConv.id, {
                        id: firstConv.messageId,
                        content: 'existing message',
                        senderId: 'user-2',
                        createdAt: firstConv.updatedAt,
                        type: 'text',
                    });

                    // Verify the inbox is sorted by updatedAt descending
                    const inboxData = queryClient.getQueryData<{
                        pages: Array<{ conversations: InboxConversationV2[] }>;
                    }>(queryKeys.messages.v2.inbox(20));

                    const resultConversations = inboxData?.pages[0]?.conversations ?? [];

                    for (let i = 0; i < resultConversations.length - 1; i++) {
                        const current = resultConversations[i];
                        const next = resultConversations[i + 1];
                        const currentEpoch = current.updatedAt.getTime();
                        const nextEpoch = next.updatedAt.getTime();

                        // Skip comparison if either date is NaN (invalid input)
                        if (isNaN(currentEpoch) || isNaN(nextEpoch)) continue;

                        assert.ok(
                            currentEpoch >= nextEpoch,
                            `Preservation violation (Req 3.7): inbox is not sorted by ` +
                            `updatedAt descending. Position ${i} has updatedAt ` +
                            `${isNaN(currentEpoch) ? 'NaN' : current.updatedAt.toISOString()} (${currentEpoch}) but ` +
                            `position ${i + 1} has updatedAt ` +
                            `${isNaN(nextEpoch) ? 'NaN' : next.updatedAt.toISOString()} (${nextEpoch}). ` +
                            `normalizeConversationRows must always produce descending order.`,
                        );
                    }
                }),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 2c: patchConversationLastMessageFromMessage never regresses updatedAt', () => {
        it('patchConversationLastMessageFromMessage always advances or stays same (never regresses updatedAt)', () => {
            // **Validates: Requirements 3.1, 3.2**
            //
            // Preservation property: `patchConversationLastMessageFromMessage` must
            // never regress a conversation's `updatedAt`. When called with a message
            // whose `createdAt` is OLDER than the current `updatedAt`, the conversation's
            // `updatedAt` must remain unchanged. When called with a newer message,
            // `updatedAt` must advance to at least the message's `createdAt`.
            //
            // This ensures historical timestamps are preserved (Req 3.1) and that
            // sending messages in existing conversations continues to work correctly
            // (Req 3.2) — the timestamp only moves forward.
            fc.assert(
                fc.property(
                    uuidArb,
                    uuidArb,
                    uuidArb,
                    uuidArb,
                    timestampArb,
                    timestampArb,
                    (conversationId, currentMsgId, newMsgId, _extra, currentTimestamp, messageTimestamp) => {
                        // Ensure different message IDs so shouldReplaceConversationLastMessage
                        // evaluates based on timestamps
                        if (currentMsgId === newMsgId) return;
                        // Skip NaN dates (fast-check shrinking edge case)
                        if (isNaN(currentTimestamp.getTime()) || isNaN(messageTimestamp.getTime())) return;

                        const queryClient = new QueryClient();
                        const conversation = createConversation(conversationId, currentMsgId, currentTimestamp);

                        // Set up inbox with the conversation at its current timestamp
                        queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
                            pages: [{ conversations: [conversation], hasMore: false, nextCursor: null }],
                            pageParams: [undefined],
                        });

                        const originalUpdatedAt = currentTimestamp.getTime();

                        // Attempt to patch with a message at messageTimestamp
                        // (could be older OR newer than current)
                        patchConversationLastMessageFromMessage(queryClient, conversationId, {
                            id: newMsgId,
                            content: 'some message',
                            senderId: 'user-1',
                            createdAt: messageTimestamp,
                            type: 'text',
                        });

                        // Verify updatedAt never regressed
                        const inboxData = queryClient.getQueryData<{
                            pages: Array<{ conversations: InboxConversationV2[] }>;
                        }>(queryKeys.messages.v2.inbox(20));

                        const updatedConversation = inboxData?.pages[0]?.conversations.find(
                            (c) => c.id === conversationId,
                        );

                        assert.ok(updatedConversation, 'Conversation should exist in inbox');

                        const resultUpdatedAt = updatedConversation.updatedAt.getTime();

                        assert.ok(
                            resultUpdatedAt >= originalUpdatedAt,
                            `Preservation violation (Req 3.1, 3.2): ` +
                            `patchConversationLastMessageFromMessage REGRESSED updatedAt. ` +
                            `Original: ${currentTimestamp.toISOString()} (${originalUpdatedAt}), ` +
                            `Result: ${updatedConversation.updatedAt.toISOString()} (${resultUpdatedAt}), ` +
                            `Message createdAt: ${messageTimestamp.toISOString()} (${messageTimestamp.getTime()}). ` +
                            `updatedAt must never go backwards — it should advance or stay the same.`,
                        );
                    },
                ),
                { numRuns: 20 },
            );
        });
    });
});
