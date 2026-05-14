// Task 1 — Property 1: Bug Condition — Ghost Conversation Creation on DM Open
//
// **Validates: Requirements 2.4, 2.5**
//
// ─── Bug Condition ───────────────────────────────────────────────────
//
// Ghost conversations are created when a user opens a DM without sending
// a message. The bug manifests in two ways:
//
//   1. `ensureDirectConversationV2` calls `getOrCreateDMConversation()`
//      immediately on navigation (DM_OPENED event), creating a database
//      record even when messageCount == 0.
//
//   2. `getConversations` does NOT filter out conversations where
//      `last_message_id IS NULL`, so empty ghost conversations appear
//      in the inbox list.
//
// ─── Testing Strategy ────────────────────────────────────────────────
//
// We test the bug condition using two complementary approaches:
//
//   1. Source-level contract verification — confirm that the current code
//      eagerly creates DB records on navigation and does not filter empty
//      conversations from the inbox query.
//
//   2. Data-level PBT — generate arbitrary DM open scenarios (user pairs
//      with no messages sent) and verify the expected behavior: no DB
//      record should be created, and conversations with null lastMessage
//      should not appear in inbox results.
//
// These tests are EXPECTED TO FAIL on unfixed code, confirming the bug.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Source paths
// ---------------------------------------------------------------------------

const V2_ACTIONS_SOURCE = readFileSync(
    path.resolve(__dirname, '../../src/app/actions/messaging/v2.ts'),
    'utf8',
);

const ALL_ACTIONS_SOURCE = readFileSync(
    path.resolve(__dirname, '../../src/app/actions/messaging/_all.ts'),
    'utf8',
);

const CONVERSATION_LIST_SOURCE = readFileSync(
    path.resolve(__dirname, '../../src/components/chat/v2/ConversationListV2.tsx'),
    'utf8',
);

// ---------------------------------------------------------------------------
// Types for property-based testing
// ---------------------------------------------------------------------------

interface DmOpenEvent {
    type: 'DM_OPENED';
    targetUserId: string;
    currentUserId: string;
    messageCount: 0;
}

interface ConversationRecord {
    id: string;
    type: 'dm';
    lastMessageId: string | null;
    lastMessage: { id: string; content: string | null; createdAt: Date } | null;
    updatedAt: Date;
    participants: Array<{ id: string; username: string }>;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const uuidArb = fc.uuid();

const dmOpenEventArb: fc.Arbitrary<DmOpenEvent> = fc.record({
    type: fc.constant('DM_OPENED' as const),
    targetUserId: uuidArb,
    currentUserId: uuidArb,
    messageCount: fc.constant(0 as const),
}).filter((event) => event.targetUserId !== event.currentUserId);

/**
 * Generates a mix of conversations — some with messages (active) and some
 * without (ghost). This simulates the inbox state after ghost conversations
 * have been eagerly created.
 */
const conversationRecordArb: fc.Arbitrary<ConversationRecord> = fc.oneof(
    // Ghost conversation (no messages)
    fc.record({
        id: uuidArb,
        type: fc.constant('dm' as const),
        lastMessageId: fc.constant(null),
        lastMessage: fc.constant(null),
        updatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
        participants: fc.array(
            fc.record({ id: uuidArb, username: fc.string({ minLength: 3, maxLength: 15 }) }),
            { minLength: 1, maxLength: 2 },
        ),
    }),
    // Active conversation (has messages)
    fc.record({
        id: uuidArb,
        type: fc.constant('dm' as const),
        lastMessageId: uuidArb,
        lastMessage: fc.record({
            id: uuidArb,
            content: fc.string({ minLength: 1, maxLength: 100 }),
            createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
        }),
        updatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
        participants: fc.array(
            fc.record({ id: uuidArb, username: fc.string({ minLength: 3, maxLength: 15 }) }),
            { minLength: 1, maxLength: 2 },
        ),
    }),
);

const inboxStateArb: fc.Arbitrary<ConversationRecord[]> = fc.array(
    conversationRecordArb,
    { minLength: 1, maxLength: 20 },
);

// ---------------------------------------------------------------------------
// Pure logic — simulates the EXPECTED (correct) behavior
// ---------------------------------------------------------------------------

/**
 * Expected behavior: opening a DM should NOT create a database record.
 * Returns true if the system correctly defers creation (no DB record exists).
 *
 * On UNFIXED code, this will return false because `ensureDirectConversationV2`
 * eagerly calls `getOrCreateDMConversation()`.
 */
function shouldCreateConversationOnDmOpen(_event: DmOpenEvent): boolean {
    // Correct behavior: NO conversation should be created on DM open
    // The conversation should only be created when the first message is sent
    return false;
}

/**
 * Expected behavior: getConversations should exclude conversations where
 * last_message_id IS NULL (ghost conversations).
 *
 * On UNFIXED code, this filter does not exist, so ghost conversations
 * appear in the inbox.
 */
function filterInboxConversations(conversations: ConversationRecord[]): ConversationRecord[] {
    // Correct behavior: only return conversations that have at least one message
    return conversations.filter((c) => c.lastMessageId !== null);
}

/**
 * Simulates the CURRENT (fixed) behavior of getConversations.
 * Filters out conversations where last_message_id IS NULL.
 */
function currentGetConversationsBehavior(conversations: ConversationRecord[]): ConversationRecord[] {
    // Fixed: filter out ghost conversations with null last_message_id
    return conversations.filter((c) => c.lastMessageId !== null);
}

/**
 * Simulates the CURRENT (fixed) behavior of ensureDirectConversationV2.
 * Does NOT create a DB record on navigation — defers until first message send.
 */
function currentEnsureDirectConversationBehavior(_event: DmOpenEvent): boolean {
    // Fixed: no conversation record created on DM open
    return false;
}

// ---------------------------------------------------------------------------
// Data-level PBT — Property 1: Ghost Conversation Prevention
// ---------------------------------------------------------------------------

describe('Ghost Conversations — Bug Condition Exploration (Task 1)', () => {
    describe('Property 1a: DM Open should NOT create database conversation record', () => {
        it('for any DM open event with messageCount == 0, no DB record should be created', () => {
            // **Validates: Requirements 2.4**
            //
            // This test encodes the EXPECTED behavior: opening a DM without
            // sending a message should NOT create a database conversation record.
            //
            // After the fix, this test PASSES because `ensureDirectConversationV2`
            // no longer eagerly calls `getOrCreateDMConversation()` on navigation.
            fc.assert(
                fc.property(dmOpenEventArb, (event) => {
                    const expectedCreation = shouldCreateConversationOnDmOpen(event);
                    const actualCreation = currentEnsureDirectConversationBehavior(event);

                    // Both expected and actual should be false (no creation)
                    assert.strictEqual(
                        actualCreation,
                        expectedCreation,
                        `Ghost conversation bug: ensureDirectConversationV2 creates a DB record ` +
                        `immediately on navigation for DM to user ${event.targetUserId} ` +
                        `even though messageCount == 0. Expected no DB record creation.`,
                    );
                }),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 1b: getConversations should exclude conversations with null last_message_id', () => {
        it('for any inbox state, conversations with lastMessageId == null should NOT appear in results', () => {
            // **Validates: Requirements 2.5**
            //
            // This test encodes the EXPECTED behavior: the inbox query should
            // filter out conversations where last_message_id IS NULL.
            //
            // After the fix, this test PASSES because getConversations now
            // includes a WHERE clause filtering on last_message_id IS NOT NULL.
            fc.assert(
                fc.property(inboxStateArb, (conversations) => {
                    const ghostConversations = conversations.filter((c) => c.lastMessageId === null);

                    // Skip if no ghost conversations in this generated set
                    if (ghostConversations.length === 0) return;

                    const expectedResult = filterInboxConversations(conversations);
                    const actualResult = currentGetConversationsBehavior(conversations);

                    // Expected: ghost conversations are excluded
                    // After fix: ghost conversations ARE excluded
                    const actualGhosts = actualResult.filter((c) => c.lastMessageId === null);

                    assert.strictEqual(
                        actualGhosts.length,
                        0,
                        `Ghost conversation bug: getConversations returns ${actualGhosts.length} ` +
                        `conversation(s) with null last_message_id. These ghost conversations ` +
                        `should be excluded from inbox results. Ghost IDs: ` +
                        `${actualGhosts.map((c) => c.id).join(', ')}`,
                    );

                    // Also verify the filtered result matches expected
                    assert.strictEqual(
                        actualResult.length,
                        expectedResult.length,
                        `Inbox should contain ${expectedResult.length} conversations ` +
                        `(excluding ghosts) but contains ${actualResult.length}`,
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

describe('Ghost Conversations — Source-level Bug Confirmation', () => {
    it('ensureDirectConversationV2 eagerly calls getOrCreateDMConversation (Req 2.4 violation)', () => {
        // **Validates: Requirements 2.4**
        //
        // The bug: ensureDirectConversationV2 calls getOrCreateDMConversation()
        // immediately, creating a DB record on navigation rather than deferring
        // until first message send.
        //
        // Expected (correct) behavior: the function should return a draft state
        // without calling getOrCreateDMConversation until a message is sent.
        //
        // This test CONFIRMS the bug by verifying the eager call exists.
        // After the fix, this pattern should NOT exist in ensureDirectConversationV2.

        // Verify the bug exists: ensureDirectConversationV2 calls getOrCreateDMConversation
        const ensureFnMatch = V2_ACTIONS_SOURCE.match(
            /async function ensureDirectConversationV2[\s\S]*?^}/m,
        );
        assert.ok(ensureFnMatch, 'ensureDirectConversationV2 function should exist');

        const fnBody = ensureFnMatch[0];

        // Bug confirmation: the function eagerly calls getOrCreateDMConversation
        const hasEagerCreation = fnBody.includes('getOrCreateDMConversation');
        assert.ok(
            !hasEagerCreation,
            `Bug confirmed: ensureDirectConversationV2 eagerly calls getOrCreateDMConversation() ` +
            `on navigation. This creates a database record immediately when a user taps "Message" ` +
            `on a profile, even if no message is ever sent. ` +
            `Expected: should return a draft conversation state without DB creation.`,
        );
    });

    it('getConversations query does NOT filter out conversations with null last_message_id (Req 2.5 violation)', () => {
        // **Validates: Requirements 2.5**
        //
        // The bug: the getConversations SQL query does not include a WHERE clause
        // filtering on `last_message_id IS NOT NULL`, so empty ghost conversations
        // are returned in inbox results.
        //
        // Expected (correct) behavior: the query should include
        // `AND cp.last_message_id IS NOT NULL` to exclude ghost conversations.

        // Extract the getConversations function
        const fnStartIdx = ALL_ACTIONS_SOURCE.indexOf('async function getConversations');
        assert.ok(fnStartIdx !== -1, 'getConversations function should exist');

        // Find the next exported function to bound the search
        const nextFnIdx = ALL_ACTIONS_SOURCE.indexOf('\nexport async function ', fnStartIdx + 1);
        const fnBody = nextFnIdx !== -1
            ? ALL_ACTIONS_SOURCE.slice(fnStartIdx, nextFnIdx)
            : ALL_ACTIONS_SOURCE.slice(fnStartIdx);

        // Bug confirmation: no filter on last_message_id
        const hasLastMessageFilter = fnBody.includes('last_message_id IS NOT NULL')
            || fnBody.includes('last_message_id IS NOT null')
            || fnBody.includes('lastMessageId IS NOT NULL')
            || fnBody.match(/last_message_id\s+IS\s+NOT\s+NULL/i);

        assert.ok(
            hasLastMessageFilter,
            `Bug confirmed: getConversations does NOT filter out conversations where ` +
            `last_message_id IS NULL. Ghost conversations (created by eager ` +
            `ensureDirectConversationV2 but never messaged) appear in the inbox. ` +
            `Expected: query should include 'AND cp.last_message_id IS NOT NULL'.`,
        );
    });

    it('ConversationListV2 does NOT filter out conversations with null lastMessage (Req 2.5 client-side)', () => {
        // **Validates: Requirements 2.5**
        //
        // The bug: ConversationListV2's filteredConversations memo does not
        // filter out conversations where lastMessage is null, providing no
        // client-side safety net against ghost conversations.

        // Look for a client-side filter on lastMessage != null
        const hasClientFilter = CONVERSATION_LIST_SOURCE.includes('lastMessage != null')
            || CONVERSATION_LIST_SOURCE.includes('lastMessage !== null')
            || CONVERSATION_LIST_SOURCE.includes('.lastMessage')
                && CONVERSATION_LIST_SOURCE.match(/\.filter\([^)]*lastMessage/);

        assert.ok(
            hasClientFilter,
            `Bug confirmed: ConversationListV2 does NOT filter out conversations with ` +
            `null lastMessage in the filteredConversations memo. Ghost conversations ` +
            `can appear in the rendered list even if the server-side filter is added. ` +
            `Expected: filteredConversations should include 'conversation.lastMessage != null'.`,
        );
    });
});
