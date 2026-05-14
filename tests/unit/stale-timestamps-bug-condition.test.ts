// Task 5 — Property 1: Bug Condition — Timestamp Staleness on Message Events
//
// **Validates: Requirements 2.1, 2.2, 2.3**
//
// ─── Bug Condition ───────────────────────────────────────────────────
//
// Stale timestamps manifest in three ways:
//
//   1. Optimistic send does NOT update inbox `updatedAt` — the send
//      mutation has no `onMutate` that calls
//      `patchConversationLastMessageFromMessage`, so the inbox
//      conversation's `updatedAt` and `lastMessage.createdAt` remain
//      stale after sending a message.
//
//   2. Real-time INSERT handler calls `patchConversationLastMessageFromMessage`
//      which SHOULD propagate the timestamp — we verify this path works
//      correctly at the cache layer.
//
//   3. After timestamp patch, `normalizeConversationRows` should re-sort
//      the conversation to position 0 (top of inbox). We verify the sort
//      is triggered through the `updateInboxData` → `normalizeConversationRows`
//      pipeline.
//
// ─── Testing Strategy ────────────────────────────────────────────────
//
// We test the bug condition using two complementary approaches:
//
//   1. Source-level contract verification — confirm that the send mutation
//      does NOT have an `onMutate` handler that patches the inbox timestamp.
//
//   2. Data-level PBT — generate arbitrary message send/receive scenarios
//      and verify the expected behavior: inbox `updatedAt` and
//      `lastMessage.createdAt` should match the new message's `createdAt`,
//      and the conversation should re-sort to position 0.
//
// The source-level test for the missing `onMutate` is EXPECTED TO FAIL
// on unfixed code, confirming the bug. The data-level tests verify the
// cache functions work correctly (these may pass since the cache layer
// itself is correct — the bug is in the CALLER not calling it).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';

import { QueryClient } from '@tanstack/react-query';

import type { MessageWithSender } from '@/app/actions/messaging';
import type { InboxConversationV2, MessageThreadPageV2, ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import {
    patchConversationLastMessageFromMessage,
    upsertThreadMessage,
} from '@/lib/messages/v2-cache';
import { queryKeys } from '@/lib/query-keys';

// ---------------------------------------------------------------------------
// Source paths
// ---------------------------------------------------------------------------

const USE_MESSAGES_V2_SOURCE = readFileSync(
    path.resolve(__dirname, '../../src/hooks/useMessagesV2.ts'),
    'utf8',
);

const USE_MESSAGES_V2_REALTIME_SOURCE = readFileSync(
    path.resolve(__dirname, '../../src/hooks/useMessagesV2Realtime.ts'),
    'utf8',
);

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
    createdAt: Date,
): InboxConversationV2 {
    return {
        id,
        type: 'dm',
        updatedAt: createdAt,
        lifecycleState: 'active',
        muted: false,
        participants: [
            { id: 'user-2', username: 'other-user', fullName: 'Other User', avatarUrl: null },
        ],
        lastMessage: {
            id: lastMessageId,
            content: 'old message',
            senderId: 'user-2',
            createdAt,
            type: 'text',
        },
        unreadCount: 0,
        lastReadAt: null,
        lastReadMessageId: null,
        capability: createCapability(),
    };
}

function createMessage(
    id: string,
    conversationId: string,
    createdAt: Date,
    content: string = 'hello',
): MessageWithSender {
    return {
        id,
        conversationId,
        senderId: 'user-1',
        clientMessageId: null,
        content,
        type: 'text',
        metadata: {},
        replyTo: null,
        createdAt,
        editedAt: null,
        deletedAt: null,
        sender: null,
        attachments: [],
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
 * Generates a pair of timestamps where the "new message" timestamp is
 * strictly after the "old message" timestamp, with enough gap to allow
 * intermediate timestamps for other conversations.
 */
const timestampPairArb = fc.tuple(timestampArb, timestampArb)
    .filter(([old, next]) => next.getTime() - old.getTime() > 60000) // at least 60s gap
    .map(([oldTs, newTs]) => {
        // Ensure old < new
        if (oldTs.getTime() > newTs.getTime()) {
            return { oldTimestamp: newTs, newTimestamp: oldTs };
        }
        return { oldTimestamp: oldTs, newTimestamp: newTs };
    });

/**
 * Generates an inbox state with multiple conversations at varying timestamps.
 * One conversation will be the "target" that receives a new message.
 * Ensures unique IDs across all conversations and valid intermediate timestamps.
 */
const inboxScenarioArb = fc.record({
    targetConversationId: uuidArb,
    oldMessageId: uuidArb,
    newMessageId: uuidArb,
    timestamps: timestampPairArb,
    otherConversationCount: fc.integer({ min: 1, max: 5 }),
}).chain((scenario) =>
    fc.array(
        fc.record({
            id: uuidArb,
            messageId: uuidArb,
            // Other conversations have timestamps AFTER the target's old timestamp
            // but BEFORE the new message timestamp — so the target should move to top
            timestamp: fc.date({
                min: new Date(scenario.timestamps.oldTimestamp.getTime() + 1000),
                max: new Date(scenario.timestamps.newTimestamp.getTime() - 1000),
            }),
        }),
        { minLength: scenario.otherConversationCount, maxLength: scenario.otherConversationCount },
    ).map((others) => ({ ...scenario, otherConversations: others })),
).filter((scenario) => {
    // Ensure all conversation IDs are unique (including target)
    const allIds = [scenario.targetConversationId, ...scenario.otherConversations.map((o) => o.id)];
    const uniqueIds = new Set(allIds);
    if (uniqueIds.size !== allIds.length) return false;
    // Ensure no NaN timestamps
    if (scenario.otherConversations.some((o) => isNaN(o.timestamp.getTime()))) return false;
    return true;
});

// ---------------------------------------------------------------------------
// Data-level PBT — Property 1: Timestamp Updates on Message Events
// ---------------------------------------------------------------------------

describe('Stale Timestamps — Bug Condition Exploration (Task 5)', () => {
    describe('Property 1a: Optimistic send should update inbox updatedAt and lastMessage.createdAt', () => {
        it('after sending a message, inbox conversation updatedAt matches message createdAt', () => {
            // **Validates: Requirements 2.1**
            //
            // This test encodes the EXPECTED behavior: after an optimistic send,
            // the inbox conversation's `updatedAt` and `lastMessage.createdAt`
            // should match the sent message's `createdAt`.
            //
            // The bug: the send mutation has no `onMutate` that calls
            // `patchConversationLastMessageFromMessage`, so the inbox timestamp
            // remains stale after sending.
            //
            // We simulate what SHOULD happen: calling
            // `patchConversationLastMessageFromMessage` after an optimistic send.
            // The source-level test below confirms this call is MISSING.
            fc.assert(
                fc.property(
                    uuidArb,
                    uuidArb,
                    uuidArb,
                    timestampPairArb,
                    (conversationId, oldMsgId, newMsgId, { oldTimestamp, newTimestamp }) => {
                        const queryClient = new QueryClient();
                        const conversation = createConversation(conversationId, oldMsgId, oldTimestamp);

                        // Set up inbox with the old conversation state
                        queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
                            pages: [{ conversations: [conversation], hasMore: false, nextCursor: null }],
                            pageParams: [undefined],
                        });

                        // Simulate what the optimistic send SHOULD do:
                        // call patchConversationLastMessageFromMessage
                        patchConversationLastMessageFromMessage(queryClient, conversationId, {
                            id: newMsgId,
                            content: 'new message',
                            senderId: 'user-1',
                            createdAt: newTimestamp,
                            type: 'text',
                        });

                        // Verify the inbox was updated
                        const inboxData = queryClient.getQueryData<{
                            pages: Array<{ conversations: InboxConversationV2[] }>;
                        }>(queryKeys.messages.v2.inbox(20));

                        const updatedConversation = inboxData?.pages[0]?.conversations.find(
                            (c) => c.id === conversationId,
                        );

                        assert.ok(updatedConversation, 'Conversation should exist in inbox');
                        assert.strictEqual(
                            updatedConversation.lastMessage?.id,
                            newMsgId,
                            `Inbox lastMessage.id should be the new message ID`,
                        );
                        assert.strictEqual(
                            updatedConversation.lastMessage?.createdAt.getTime(),
                            newTimestamp.getTime(),
                            `Inbox lastMessage.createdAt should match new message timestamp`,
                        );
                        assert.ok(
                            updatedConversation.updatedAt.getTime() >= newTimestamp.getTime(),
                            `Inbox updatedAt should be >= new message timestamp`,
                        );
                    },
                ),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 1b: Real-time INSERT should propagate timestamp to inbox', () => {
        it('after real-time INSERT, patchConversationLastMessageFromMessage updates both preview AND timestamp', () => {
            // **Validates: Requirements 2.2**
            //
            // This test verifies that `patchConversationLastMessageFromMessage`
            // correctly updates both the message preview AND the timestamp
            // when called from the real-time INSERT handler.
            fc.assert(
                fc.property(
                    uuidArb,
                    uuidArb,
                    uuidArb,
                    timestampPairArb,
                    fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
                    (conversationId, oldMsgId, newMsgId, { oldTimestamp, newTimestamp }, newContent) => {
                        const queryClient = new QueryClient();
                        const conversation = createConversation(conversationId, oldMsgId, oldTimestamp);

                        // Set up inbox and thread
                        queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
                            pages: [{ conversations: [conversation], hasMore: false, nextCursor: null }],
                            pageParams: [undefined],
                        });
                        queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
                            queryKeys.messages.v2.thread(conversationId),
                            {
                                pages: [{
                                    conversation,
                                    capability: conversation.capability,
                                    messages: [createMessage(oldMsgId, conversationId, oldTimestamp)],
                                    pinnedMessages: [],
                                    hasMore: false,
                                    nextCursor: null,
                                }],
                                pageParams: [undefined],
                            },
                        );

                        // Simulate real-time INSERT: upsert message then patch conversation
                        const newMessage = createMessage(newMsgId, conversationId, newTimestamp, newContent);
                        upsertThreadMessage(queryClient, conversationId, newMessage);
                        patchConversationLastMessageFromMessage(queryClient, conversationId, newMessage);

                        // Verify inbox was updated with both preview AND timestamp
                        const inboxData = queryClient.getQueryData<{
                            pages: Array<{ conversations: InboxConversationV2[] }>;
                        }>(queryKeys.messages.v2.inbox(20));

                        const updatedConversation = inboxData?.pages[0]?.conversations.find(
                            (c) => c.id === conversationId,
                        );

                        assert.ok(updatedConversation, 'Conversation should exist in inbox');

                        // Preview should be updated
                        assert.strictEqual(
                            updatedConversation.lastMessage?.id,
                            newMsgId,
                            `Inbox lastMessage should be updated to new message`,
                        );
                        // Note: content may be transformed by getMessagePreviewText
                        // (e.g. whitespace-only → "Message"), so we just verify it's set
                        assert.ok(
                            updatedConversation.lastMessage?.content !== undefined,
                            `Inbox lastMessage content should be set`,
                        );

                        // Timestamp should be updated
                        assert.strictEqual(
                            updatedConversation.lastMessage?.createdAt.getTime(),
                            newTimestamp.getTime(),
                            `Inbox lastMessage.createdAt should match new message timestamp ` +
                            `(was ${updatedConversation.lastMessage?.createdAt.toISOString()}, ` +
                            `expected ${newTimestamp.toISOString()})`,
                        );
                        assert.ok(
                            updatedConversation.updatedAt.getTime() >= newTimestamp.getTime(),
                            `Inbox updatedAt should be >= new message timestamp ` +
                            `(was ${updatedConversation.updatedAt.toISOString()}, ` +
                            `expected >= ${newTimestamp.toISOString()})`,
                        );
                    },
                ),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 1c: After timestamp patch, conversation re-sorts to position 0', () => {
        it('after patching a conversation timestamp, normalizeConversationRows re-sorts it to the top', () => {
            // **Validates: Requirements 2.3**
            //
            // This test verifies that after `patchConversationLastMessageFromMessage`
            // updates a conversation's `updatedAt`, the inbox list re-sorts so
            // the updated conversation appears at position 0 (top).
            fc.assert(
                fc.property(inboxScenarioArb, (scenario) => {
                    const queryClient = new QueryClient();

                    // Create the target conversation with an OLD timestamp
                    const targetConversation = createConversation(
                        scenario.targetConversationId,
                        scenario.oldMessageId,
                        scenario.timestamps.oldTimestamp,
                    );

                    // Create other conversations with timestamps BETWEEN old and new
                    const otherConversations = scenario.otherConversations.map((other) =>
                        createConversation(other.id, other.messageId, other.timestamp),
                    );

                    // Set up inbox with target at the BOTTOM (oldest)
                    const allConversations = [...otherConversations, targetConversation];
                    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
                        pages: [{ conversations: allConversations, hasMore: false, nextCursor: null }],
                        pageParams: [undefined],
                    });

                    // Patch the target conversation with a NEW timestamp (newest of all)
                    patchConversationLastMessageFromMessage(queryClient, scenario.targetConversationId, {
                        id: scenario.newMessageId,
                        content: 'new message',
                        senderId: 'user-1',
                        createdAt: scenario.timestamps.newTimestamp,
                        type: 'text',
                    });

                    // Verify the target conversation moved to position 0
                    const inboxData = queryClient.getQueryData<{
                        pages: Array<{ conversations: InboxConversationV2[] }>;
                    }>(queryKeys.messages.v2.inbox(20));

                    const conversations = inboxData?.pages[0]?.conversations ?? [];
                    assert.ok(conversations.length > 0, 'Inbox should have conversations');

                    assert.strictEqual(
                        conversations[0]?.id,
                        scenario.targetConversationId,
                        `After timestamp patch, conversation should be at position 0 (top of inbox). ` +
                        `Instead found "${conversations[0]?.id}" at position 0. ` +
                        `Target conversation "${scenario.targetConversationId}" is at position ` +
                        `${conversations.findIndex((c) => c.id === scenario.targetConversationId)}. ` +
                        `Target updatedAt: ${scenario.timestamps.newTimestamp.toISOString()}, ` +
                        `Top conversation updatedAt: ${conversations[0]?.updatedAt.toISOString()}`,
                    );
                }),
                { numRuns: 20 },
            );
        });
    });
});

// ---------------------------------------------------------------------------
// Source-level contracts — verify the bug exists in the source code
// ---------------------------------------------------------------------------

describe('Stale Timestamps — Source-level Bug Confirmation', () => {
    it('sendConversationMessage mutation has onMutate that patches inbox timestamp (Req 2.1 violation)', () => {
        // **Validates: Requirements 2.1**
        //
        // The bug: the `sendConversationMessage` mutation does NOT have an
        // `onMutate` handler that calls `patchConversationLastMessageFromMessage`.
        // This means the inbox conversation's `updatedAt` and `lastMessage.createdAt`
        // remain stale after an optimistic send.
        //
        // Expected (correct) behavior: the mutation should have an `onMutate`
        // that patches the inbox timestamp immediately on send.
        //
        // This test CONFIRMS the bug by verifying the `onMutate` is missing
        // or does not call `patchConversationLastMessageFromMessage`.

        // Find the sendConversationMessage mutation definition
        const sendMutationStart = USE_MESSAGES_V2_SOURCE.indexOf('sendConversationMessage = useMutation');
        assert.ok(sendMutationStart !== -1, 'sendConversationMessage mutation should exist');

        // Extract the mutation body (find the matching closing brace)
        // Look for the next `useMutation` or end of function to bound the search
        const nextMutationIdx = USE_MESSAGES_V2_SOURCE.indexOf('useMutation', sendMutationStart + 40);
        const mutationBody = nextMutationIdx !== -1
            ? USE_MESSAGES_V2_SOURCE.slice(sendMutationStart, nextMutationIdx)
            : USE_MESSAGES_V2_SOURCE.slice(sendMutationStart, sendMutationStart + 2000);

        // Check if onMutate exists in the send mutation
        const hasOnMutate = mutationBody.includes('onMutate');

        // Check if patchConversationLastMessageFromMessage is called in onMutate
        const hasPatchInOnMutate = hasOnMutate &&
            mutationBody.includes('patchConversationLastMessageFromMessage');

        assert.ok(
            hasPatchInOnMutate,
            `Bug confirmed: sendConversationMessage mutation does NOT have an onMutate ` +
            `handler that calls patchConversationLastMessageFromMessage. ` +
            `The inbox conversation's updatedAt and lastMessage.createdAt remain stale ` +
            `after sending a message. ` +
            `Expected: onMutate should call patchConversationLastMessageFromMessage ` +
            `with the optimistic message's createdAt to immediately update the inbox.`,
        );
    });

    it('real-time INSERT handler calls patchConversationLastMessageFromMessage (Req 2.2 verification)', () => {
        // **Validates: Requirements 2.2**
        //
        // Verify that the real-time INSERT handler in useMessagesV2Realtime.ts
        // calls `patchConversationLastMessageFromMessage` after receiving a
        // new message via real-time.
        //
        // This path DOES exist in the current code (the real-time handler
        // calls it), but we verify it's present for completeness.

        const hasRealtimePatch = USE_MESSAGES_V2_REALTIME_SOURCE.includes('patchConversationLastMessageFromMessage');

        assert.ok(
            hasRealtimePatch,
            `Real-time handler should call patchConversationLastMessageFromMessage. ` +
            `This is needed to propagate timestamps from real-time INSERT events.`,
        );

        // Verify it's called in the INSERT handler path specifically
        const insertHandlerSection = USE_MESSAGES_V2_REALTIME_SOURCE.indexOf("eventType === 'INSERT'");
        assert.ok(insertHandlerSection !== -1, 'INSERT handler should exist in realtime hook');

        // Find patchConversationLastMessageFromMessage after the INSERT check
        const patchAfterInsert = USE_MESSAGES_V2_REALTIME_SOURCE.indexOf(
            'patchConversationLastMessageFromMessage',
            insertHandlerSection,
        );
        assert.ok(
            patchAfterInsert !== -1,
            `patchConversationLastMessageFromMessage should be called after INSERT event handling`,
        );
    });
});
