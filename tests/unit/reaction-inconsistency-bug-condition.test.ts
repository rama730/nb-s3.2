// Task 9 — Property 1: Bug Condition — Reaction Toggle Visibility and Persistence
//
// **Validates: Requirements 2.6, 2.7, 2.8, 2.9**
//
// ─── Bug Condition ───────────────────────────────────────────────────
//
// Reaction inconsistency manifests in three ways:
//
//   1. Reaction toggle does NOT update cache optimistically via a dedicated
//      hook with proper `onMutate`/`onError` rollback pattern. Instead,
//      the optimistic update is done inline in the component, which is
//      fragile and can be overwritten by stale refetches.
//
//   2. JSONB-only updates to `metadata.reactionSummary` do not reliably
//      fire Supabase real-time events. There is no dedicated subscription
//      for the `message_reactions` table to detect other users' reactions.
//
//   3. The `MessageReactionSummary` type only stores `{emoji, count,
//      viewerReacted}` without per-user attribution (userId, username,
//      avatarUrl), making it impossible to show who reacted in group chats.
//
// ─── Testing Strategy ────────────────────────────────────────────────
//
// We test the bug condition using two complementary approaches:
//
//   1. Source-level contract verification — confirm that:
//      (a) No dedicated `useToggleReaction` hook exists with proper
//          optimistic mutation pattern in useMessagesV2.ts
//      (b) No real-time subscription for `message_reactions` table exists
//          in useMessagesV2Realtime.ts
//      (c) No `MessageReactionDetail` type with per-user attribution
//          exists in reactions.ts
//
//   2. Data-level PBT — generate arbitrary reaction toggle sequences and
//      verify the expected behavior:
//      (a) `toggleMessageReactionSummary` produces correct optimistic state
//          with proper count and `viewerReacted` flag
//      (b) Reaction data includes user attribution (userId, emoji) for
//          group conversation detail display
//
// Source-level tests are EXPECTED TO FAIL on unfixed code, confirming the bug.
// Data-level tests verify the pure function works correctly but expose the
// missing attribution.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';

import {
    toggleMessageReactionSummary,
    buildReactionSummaryByMessage,
    buildReactionDetails,
    type MessageReactionSummary,
} from '@/lib/messages/reactions';

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

const REACTIONS_SOURCE = readFileSync(
    path.resolve(__dirname, '../../src/lib/messages/reactions.ts'),
    'utf8',
);

// ---------------------------------------------------------------------------
// Types for property-based testing
// ---------------------------------------------------------------------------

interface ReactionToggleEvent {
    type: 'REACTION_TOGGLED';
    messageId: string;
    emoji: string;
    userId: string;
    conversationId: string;
}

interface ReactionDetailExpected {
    userId: string;
    emoji: string;
    messageId: string;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const uuidArb = fc.uuid();

const emojiArb = fc.oneof(
    fc.constant('👍'),
    fc.constant('❤️'),
    fc.constant('😂'),
    fc.constant('🔥'),
    fc.constant('😮'),
    fc.constant('😢'),
    fc.constant('🎉'),
    fc.constant('👎'),
);

const reactionToggleEventArb: fc.Arbitrary<ReactionToggleEvent> = fc.record({
    type: fc.constant('REACTION_TOGGLED' as const),
    messageId: uuidArb,
    emoji: emojiArb,
    userId: uuidArb,
    conversationId: uuidArb,
});

/**
 * Generates a valid reaction summary state (non-empty, positive counts).
 */
const reactionSummaryArb: fc.Arbitrary<MessageReactionSummary[]> = fc.array(
    fc.record({
        emoji: emojiArb,
        count: fc.integer({ min: 1, max: 20 }),
        viewerReacted: fc.boolean(),
    }),
    { minLength: 0, maxLength: 5 },
).map((reactions) => {
    // Deduplicate by emoji, keeping the first occurrence
    const seen = new Set<string>();
    return reactions.filter((r) => {
        if (seen.has(r.emoji)) return false;
        seen.add(r.emoji);
        return true;
    });
});

/**
 * Generates a set of reaction rows from multiple users on a message,
 * simulating a group conversation scenario.
 */
const groupReactionRowsArb = fc.record({
    messageId: uuidArb,
    users: fc.array(uuidArb, { minLength: 2, maxLength: 6 }),
    emoji: emojiArb,
}).chain((scenario) =>
    fc.shuffledSubarray(scenario.users, { minLength: 1 }).map((reactingUsers) => ({
        messageId: scenario.messageId,
        emoji: scenario.emoji,
        rows: reactingUsers.map((userId) => ({
            messageId: scenario.messageId,
            emoji: scenario.emoji,
            userId,
        })),
        reactingUsers,
    })),
);

// ---------------------------------------------------------------------------
// Data-level PBT — Property 1: Reaction Toggle Visibility and Persistence
// ---------------------------------------------------------------------------

describe('Reaction Inconsistency — Bug Condition Exploration (Task 9)', () => {
    describe('Property 1a: toggleMessageReactionSummary produces correct optimistic state', () => {
        it('toggling a reaction updates count and viewerReacted flag correctly', () => {
            // **Validates: Requirements 2.6**
            //
            // This test verifies that `toggleMessageReactionSummary` produces
            // the correct optimistic state when toggling a reaction. The pure
            // function itself works correctly — the bug is that it's not called
            // via a proper `useToggleReaction` hook with `onMutate`/`onError`.
            fc.assert(
                fc.property(reactionSummaryArb, emojiArb, (reactions, emoji) => {
                    const result = toggleMessageReactionSummary(reactions, emoji);

                    const existingReaction = reactions.find((r) => r.emoji === emoji);

                    if (!existingReaction) {
                        // Adding a new reaction: should appear with count=1, viewerReacted=true
                        const added = result.find((r) => r.emoji === emoji);
                        assert.ok(added, `New reaction "${emoji}" should appear in result`);
                        assert.strictEqual(added.count, 1, `New reaction count should be 1`);
                        assert.strictEqual(added.viewerReacted, true, `New reaction viewerReacted should be true`);
                    } else if (existingReaction.viewerReacted) {
                        // Removing viewer's reaction
                        if (existingReaction.count <= 1) {
                            // Reaction should be removed entirely
                            const removed = result.find((r) => r.emoji === emoji);
                            assert.strictEqual(removed, undefined, `Reaction "${emoji}" should be removed when count was 1`);
                        } else {
                            // Count should decrease, viewerReacted should be false
                            const updated = result.find((r) => r.emoji === emoji);
                            assert.ok(updated, `Reaction "${emoji}" should still exist`);
                            assert.strictEqual(updated.count, existingReaction.count - 1, `Count should decrease by 1`);
                            assert.strictEqual(updated.viewerReacted, false, `viewerReacted should be false after removal`);
                        }
                    } else {
                        // Adding viewer's reaction to existing emoji
                        const updated = result.find((r) => r.emoji === emoji);
                        assert.ok(updated, `Reaction "${emoji}" should still exist`);
                        assert.strictEqual(updated.count, existingReaction.count + 1, `Count should increase by 1`);
                        assert.strictEqual(updated.viewerReacted, true, `viewerReacted should be true after adding`);
                    }
                }),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 1b: Reaction data should include per-user attribution for group conversations', () => {
        it('buildReactionDetails provides per-user attribution for group conversation reaction detail display', () => {
            // **Validates: Requirements 2.9**
            //
            // This test verifies that `buildReactionDetails` correctly aggregates
            // per-user reaction data from `message_reactions` rows, providing
            // userId attribution needed for the reaction detail sheet in group
            // conversations.
            //
            // The fix: `buildReactionDetails` function was added to reactions.ts
            // that takes reaction rows (with userId, username, avatarUrl) and
            // groups them by emoji, providing full per-user attribution.
            fc.assert(
                fc.property(groupReactionRowsArb, (scenario) => {
                    // Build detail rows with user attribution (simulating joined data)
                    const detailRows = scenario.rows.map((row) => ({
                        userId: row.userId,
                        username: `user_${row.userId.slice(0, 8)}`,
                        avatarUrl: null,
                        emoji: row.emoji,
                        createdAt: new Date(),
                    }));

                    const details = buildReactionDetails(detailRows);

                    // Verify per-user attribution is available
                    assert.ok(details.length > 0, 'Should have at least one emoji group');

                    const emojiGroup = details.find((d) => d.emoji === scenario.emoji);
                    assert.ok(emojiGroup, `Emoji "${scenario.emoji}" should be in details`);
                    assert.ok(emojiGroup.users.length > 0, 'Should have at least one user');

                    // Verify each user has proper attribution fields
                    for (const user of emojiGroup.users) {
                        assert.ok(user.userId, 'Each user should have a userId');
                        assert.ok(user.username, 'Each user should have a username');
                        assert.ok('avatarUrl' in user, 'Each user should have an avatarUrl field');
                    }

                    // Verify the correct number of unique users
                    const uniqueUserIds = new Set(emojiGroup.users.map((u) => u.userId));
                    assert.strictEqual(
                        uniqueUserIds.size,
                        scenario.reactingUsers.length,
                        `Should have ${scenario.reactingUsers.length} unique users in detail`,
                    );

                    // Verify all reacting users are represented
                    for (const userId of scenario.reactingUsers) {
                        assert.ok(
                            emojiGroup.users.some((u) => u.userId === userId),
                            `User ${userId} should be in the reaction detail`,
                        );
                    }
                }),
                { numRuns: 20 },
            );
        });
    });
});

// ---------------------------------------------------------------------------
// Source-level contracts — verify the bug exists in the source code
// ---------------------------------------------------------------------------

describe('Reaction Inconsistency — Source-level Bug Confirmation', () => {
    it('useMessagesV2.ts has a dedicated useToggleReaction hook with onMutate optimistic pattern (Req 2.6, 2.7)', () => {
        // **Validates: Requirements 2.6, 2.7**
        //
        // The bug: there is no dedicated `useToggleReaction` hook in
        // useMessagesV2.ts that implements the proper optimistic mutation
        // pattern (onMutate → patch cache, onError → rollback).
        //
        // Instead, the optimistic update is done inline in MessageBubbleV2.tsx
        // which is fragile — it can be overwritten by stale refetches and
        // does not follow the React Query mutation best practice.
        //
        // Expected (correct) behavior: a `useToggleReaction` mutation hook
        // with `onMutate` that calls `toggleMessageReactionSummary` to patch
        // the cache optimistically, and `onError` that rolls back.

        const hasUseToggleReaction = USE_MESSAGES_V2_SOURCE.includes('useToggleReaction')
            || USE_MESSAGES_V2_SOURCE.includes('toggleReaction')
                && USE_MESSAGES_V2_SOURCE.includes('useMutation')
                && USE_MESSAGES_V2_SOURCE.includes('onMutate');

        assert.ok(
            hasUseToggleReaction,
            `Bug confirmed: useMessagesV2.ts does NOT have a dedicated useToggleReaction ` +
            `hook with proper onMutate/onError optimistic mutation pattern. ` +
            `The reaction toggle is handled inline in MessageBubbleV2.tsx without ` +
            `React Query's mutation lifecycle (onMutate → optimistic patch, ` +
            `onError → rollback, onSettled → sync). This causes reactions to be ` +
            `delayed or overwritten by stale refetches. ` +
            `Expected: a useToggleReaction mutation hook in useMessagesV2.ts.`,
        );
    });

    it('useMessagesV2Realtime.ts subscribes to message_reactions table for real-time sync (Req 2.8)', () => {
        // **Validates: Requirements 2.8**
        //
        // The bug: the real-time hook does NOT subscribe to the
        // `message_reactions` table. It only listens to `messages`,
        // `conversation_participants`, `message_delivery_receipts`, and
        // `message_read_receipts`.
        //
        // When reactions are stored in a dedicated `message_reactions` table,
        // the real-time subscription should listen for INSERT/DELETE events
        // on that table to sync other users' reactions.
        //
        // Currently, reaction changes are detected via JSONB metadata changes
        // on the `messages` table, which is unreliable (Supabase limitation).

        const hasReactionTableSubscription =
            USE_MESSAGES_V2_REALTIME_SOURCE.includes("table: 'message_reactions'")
            || USE_MESSAGES_V2_REALTIME_SOURCE.includes('table: "message_reactions"')
            || USE_MESSAGES_V2_REALTIME_SOURCE.includes('message_reactions');

        // Check if it's a proper subscription (not just an import or comment)
        const hasProperSubscription =
            hasReactionTableSubscription
            && (USE_MESSAGES_V2_REALTIME_SOURCE.includes("event: 'INSERT'")
                || USE_MESSAGES_V2_REALTIME_SOURCE.includes("event: '*'"))
            && USE_MESSAGES_V2_REALTIME_SOURCE.match(/table:\s*['"]message_reactions['"]/);

        assert.ok(
            hasProperSubscription,
            `Bug confirmed: useMessagesV2Realtime.ts does NOT subscribe to the ` +
            `message_reactions table for real-time sync. The hook only subscribes to: ` +
            `messages, conversation_participants, message_delivery_receipts, and ` +
            `message_read_receipts. Without a dedicated subscription for ` +
            `message_reactions, other users' reactions are only detected via ` +
            `unreliable JSONB metadata changes on the messages table. ` +
            `Expected: a subscription for INSERT/DELETE on message_reactions table.`,
        );
    });

    it('reactions.ts exports MessageReactionDetail type with per-user attribution (Req 2.9)', () => {
        // **Validates: Requirements 2.9**
        //
        // The bug: reactions.ts does NOT export a `MessageReactionDetail` type
        // that includes per-user attribution (userId, username, avatarUrl).
        //
        // The current `MessageReactionSummary` type only stores:
        //   { emoji: string; count: number; viewerReacted: boolean }
        //
        // This makes it impossible to show a reaction detail sheet in group
        // conversations that displays which users reacted with each emoji.
        //
        // Expected (correct) behavior: a `MessageReactionDetail` type with
        // userId, username, avatarUrl fields, and a `buildReactionDetails`
        // function that aggregates per-user reaction data.

        const hasReactionDetailType = REACTIONS_SOURCE.includes('MessageReactionDetail')
            || REACTIONS_SOURCE.includes('ReactionDetail');

        const hasBuildReactionDetails = REACTIONS_SOURCE.includes('buildReactionDetails')
            || REACTIONS_SOURCE.includes('getReactionDetails');

        assert.ok(
            hasReactionDetailType && hasBuildReactionDetails,
            `Bug confirmed: reactions.ts does NOT export a MessageReactionDetail type ` +
            `or buildReactionDetails function for per-user attribution. ` +
            `Current MessageReactionSummary only stores {emoji, count, viewerReacted} ` +
            `without tracking which specific users reacted. ` +
            `In group conversations, users see "👍 3" but cannot determine who reacted. ` +
            `Expected: MessageReactionDetail type with userId/username/avatarUrl fields ` +
            `and a buildReactionDetails function for the reaction detail sheet.`,
        );
    });
});
