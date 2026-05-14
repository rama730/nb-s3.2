// Task 10 — Property 2: Preservation — Existing Reaction Display Behavior
//
// **Validates: Requirements 3.5, 3.6**
//
// ─── Preservation Requirements ───────────────────────────────────────
//
// These tests capture EXISTING correct behavior that must NOT regress
// after the reaction inconsistency fix is applied:
//
//   3.5 — WHEN a user reacts to a message in a 1:1 conversation THEN
//         the system SHALL CONTINUE TO show the reaction emoji and count
//         on the message bubble
//
//   3.6 — WHEN another user adds a reaction via real-time THEN the system
//         SHALL CONTINUE TO update the reaction display for all participants
//         in the conversation
//
// ─── Testing Strategy ────────────────────────────────────────────────
//
// Observation-first methodology:
//   1. Observe: `toggleMessageReactionSummary` correctly computes next state
//      (add/remove emoji, update count, toggle `viewerReacted`)
//   2. Observe: Reactions in 1:1 conversations show emoji + count on message
//      bubbles (the summary always has emoji + count fields)
//   3. Observe: Real-time reactions from other users update the display for
//      all participants (buildReactionSummaryByMessage aggregates correctly)
//
// These tests are EXPECTED TO PASS on unfixed code (preservation).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import {
    toggleMessageReactionSummary,
    buildReactionSummaryByMessage,
    normalizeMessageReactionSummary,
    type MessageReactionSummary,
} from '@/lib/messages/reactions';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

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

const uuidArb = fc.uuid();

/**
 * Generates a valid, deduplicated reaction summary state.
 * Each emoji appears at most once with a positive count.
 */
const reactionSummaryArb: fc.Arbitrary<MessageReactionSummary[]> = fc.array(
    fc.record({
        emoji: emojiArb,
        count: fc.integer({ min: 1, max: 50 }),
        viewerReacted: fc.boolean(),
    }),
    { minLength: 0, maxLength: 6 },
).map((reactions) => {
    const seen = new Set<string>();
    return reactions.filter((r) => {
        if (seen.has(r.emoji)) return false;
        seen.add(r.emoji);
        return true;
    });
});

/**
 * Generates a sequence of emoji toggles to apply in order.
 */
const toggleSequenceArb: fc.Arbitrary<string[]> = fc.array(emojiArb, {
    minLength: 1,
    maxLength: 10,
});

/**
 * Generates reaction rows from multiple users on a single message,
 * simulating a 1:1 or group conversation scenario.
 */
const reactionRowsArb = fc.record({
    messageId: uuidArb,
    viewerId: uuidArb,
    otherUserId: uuidArb,
}).chain((ctx) =>
    fc.array(
        fc.record({
            emoji: emojiArb,
            userId: fc.constantFrom(ctx.viewerId, ctx.otherUserId),
        }),
        { minLength: 1, maxLength: 8 },
    ).map((entries) => ({
        messageId: ctx.messageId,
        viewerId: ctx.viewerId,
        otherUserId: ctx.otherUserId,
        rows: entries.map((e) => ({
            messageId: ctx.messageId,
            emoji: e.emoji,
            userId: e.userId,
        })),
    })),
);

// ---------------------------------------------------------------------------
// Property-Based Tests — Preservation
// ---------------------------------------------------------------------------

describe('Reaction Preservation — Property Tests (Task 10)', () => {
    describe('Property 2a: toggleMessageReactionSummary maintains invariants for all toggle sequences', () => {
        it('for all reaction toggle sequences, count >= 0, no duplicate emojis, viewerReacted consistency', () => {
            // **Validates: Requirements 3.5**
            //
            // Preservation property: for any sequence of reaction toggles applied
            // to any initial state, `toggleMessageReactionSummary` must maintain:
            //   - count >= 0 for all reactions in the result
            //   - no duplicate emojis in the result array
            //   - viewerReacted consistency (if viewer just toggled ON, it's true;
            //     if toggled OFF, it's false or the reaction is removed)
            fc.assert(
                fc.property(reactionSummaryArb, toggleSequenceArb, (initialState, toggles) => {
                    let current = [...initialState];

                    for (const emoji of toggles) {
                        const result = toggleMessageReactionSummary(current, emoji);

                        // Invariant 1: All counts must be >= 0
                        for (const reaction of result) {
                            assert.ok(
                                reaction.count >= 0,
                                `Invariant violation: reaction "${reaction.emoji}" has ` +
                                `negative count ${reaction.count} after toggling "${emoji}". ` +
                                `Counts must always be non-negative.`,
                            );
                        }

                        // Invariant 2: No duplicate emojis in the result
                        const emojis = result.map((r) => r.emoji);
                        const uniqueEmojis = new Set(emojis);
                        assert.strictEqual(
                            emojis.length,
                            uniqueEmojis.size,
                            `Invariant violation: duplicate emojis found in result ` +
                            `after toggling "${emoji}". Emojis: [${emojis.join(', ')}]. ` +
                            `Each emoji must appear at most once.`,
                        );

                        // Invariant 3: viewerReacted consistency
                        // After toggling an emoji, check the result for that emoji
                        const existedBefore = current.find((r) => r.emoji === emoji);
                        const existsAfter = result.find((r) => r.emoji === emoji);

                        if (!existedBefore) {
                            // Added new reaction: must be viewerReacted=true
                            assert.ok(
                                existsAfter !== undefined,
                                `Consistency violation: toggling new emoji "${emoji}" ` +
                                `should add it to the result.`,
                            );
                            assert.strictEqual(
                                existsAfter!.viewerReacted,
                                true,
                                `Consistency violation: newly added reaction "${emoji}" ` +
                                `should have viewerReacted=true.`,
                            );
                        } else if (existedBefore.viewerReacted) {
                            // Toggled OFF: either removed or viewerReacted=false
                            if (existsAfter) {
                                assert.strictEqual(
                                    existsAfter.viewerReacted,
                                    false,
                                    `Consistency violation: toggling OFF "${emoji}" ` +
                                    `should set viewerReacted=false.`,
                                );
                            }
                            // If existsAfter is undefined, the reaction was removed (count was 1)
                        } else {
                            // Toggled ON: viewerReacted must be true
                            assert.ok(
                                existsAfter !== undefined,
                                `Consistency violation: toggling ON existing emoji "${emoji}" ` +
                                `should keep it in the result.`,
                            );
                            assert.strictEqual(
                                existsAfter!.viewerReacted,
                                true,
                                `Consistency violation: toggling ON "${emoji}" ` +
                                `should set viewerReacted=true.`,
                            );
                        }

                        // Invariant 4: All counts must be positive (reactions with count 0 are removed)
                        for (const reaction of result) {
                            assert.ok(
                                reaction.count > 0,
                                `Invariant violation: reaction "${reaction.emoji}" has ` +
                                `count ${reaction.count}. Reactions with count <= 0 ` +
                                `should be removed from the array.`,
                            );
                        }

                        current = result;
                    }
                }),
                { numRuns: 20 },
            );
        });
    });

    describe('Property 2b: Existing 1:1 reactions display emoji + count correctly', () => {
        it('for all non-buggy reaction states, display continues to show emoji + count', () => {
            // **Validates: Requirements 3.5, 3.6**
            //
            // Preservation property: for any set of reaction rows from users in a
            // 1:1 conversation, `buildReactionSummaryByMessage` produces a summary
            // where each entry has a valid emoji string and a positive count.
            // This ensures the reaction display (emoji + count on message bubbles)
            // continues to work correctly.
            //
            // Additionally, when another user adds a reaction (simulating real-time),
            // the summary correctly reflects the updated state for all participants.
            fc.assert(
                fc.property(reactionRowsArb, (scenario) => {
                    const summary = buildReactionSummaryByMessage(
                        scenario.rows,
                        scenario.viewerId,
                    );

                    const messageSummary = summary[scenario.messageId];
                    assert.ok(
                        messageSummary !== undefined,
                        `Display violation: message ${scenario.messageId} should have ` +
                        `a reaction summary when reactions exist.`,
                    );

                    // Every reaction entry must have emoji + count for display
                    for (const reaction of messageSummary) {
                        // Emoji must be a non-empty string
                        assert.ok(
                            typeof reaction.emoji === 'string' && reaction.emoji.length > 0,
                            `Display violation: reaction must have a non-empty emoji string ` +
                            `for display on message bubble. Got: "${reaction.emoji}".`,
                        );

                        // Count must be a positive integer
                        assert.ok(
                            typeof reaction.count === 'number' && reaction.count > 0,
                            `Display violation: reaction "${reaction.emoji}" must have a ` +
                            `positive count for display. Got: ${reaction.count}.`,
                        );

                        // viewerReacted must be a boolean
                        assert.ok(
                            typeof reaction.viewerReacted === 'boolean',
                            `Display violation: reaction "${reaction.emoji}" must have a ` +
                            `boolean viewerReacted field. Got: ${reaction.viewerReacted}.`,
                        );
                    }

                    // No duplicate emojis in the summary
                    const emojis = messageSummary.map((r) => r.emoji);
                    const uniqueEmojis = new Set(emojis);
                    assert.strictEqual(
                        emojis.length,
                        uniqueEmojis.size,
                        `Display violation: duplicate emojis in summary. ` +
                        `Emojis: [${emojis.join(', ')}]. Each emoji should appear once.`,
                    );

                    // Verify viewer's reactions are correctly marked
                    const viewerRows = scenario.rows.filter(
                        (r) => r.userId === scenario.viewerId,
                    );
                    const viewerEmojis = new Set(viewerRows.map((r) => r.emoji));

                    for (const reaction of messageSummary) {
                        if (viewerEmojis.has(reaction.emoji)) {
                            assert.strictEqual(
                                reaction.viewerReacted,
                                true,
                                `Display violation: viewer reacted with "${reaction.emoji}" ` +
                                `but viewerReacted is false. The viewer's own reactions ` +
                                `must be highlighted on the message bubble.`,
                            );
                        }
                    }

                    // Verify other user's reactions are counted (simulates real-time update)
                    const otherUserRows = scenario.rows.filter(
                        (r) => r.userId === scenario.otherUserId,
                    );
                    const otherUserEmojis = new Set(otherUserRows.map((r) => r.emoji));

                    for (const emoji of otherUserEmojis) {
                        const reaction = messageSummary.find((r) => r.emoji === emoji);
                        assert.ok(
                            reaction !== undefined,
                            `Real-time sync violation: other user reacted with "${emoji}" ` +
                            `but it does not appear in the summary. Real-time reactions ` +
                            `from other users must update the display for all participants.`,
                        );
                        // Count must be at least 1 (the other user's reaction)
                        assert.ok(
                            reaction!.count >= 1,
                            `Real-time sync violation: reaction "${emoji}" from other user ` +
                            `should have count >= 1. Got: ${reaction!.count}.`,
                        );
                    }
                }),
                { numRuns: 20 },
            );
        });

        it('normalizeMessageReactionSummary always produces valid display state', () => {
            // **Validates: Requirements 3.5**
            //
            // Preservation property: normalizeMessageReactionSummary always produces
            // a valid array where each entry has emoji (non-empty string), count > 0,
            // and viewerReacted (boolean). This ensures the display layer always
            // receives well-formed data.
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            emoji: fc.oneof(emojiArb, fc.string({ minLength: 0, maxLength: 5 })),
                            count: fc.oneof(
                                fc.integer({ min: -5, max: 50 }),
                                fc.constant(0),
                                fc.constant(NaN),
                            ),
                            viewerReacted: fc.oneof(fc.boolean(), fc.constant(undefined as unknown as boolean)),
                        }),
                        { minLength: 0, maxLength: 8 },
                    ),
                    (rawInput) => {
                        const normalized = normalizeMessageReactionSummary(rawInput);

                        // Result must be an array
                        assert.ok(
                            Array.isArray(normalized),
                            `normalizeMessageReactionSummary must always return an array.`,
                        );

                        for (const reaction of normalized) {
                            // Each entry must have a non-empty emoji
                            assert.ok(
                                typeof reaction.emoji === 'string' && reaction.emoji.length > 0,
                                `Normalized reaction must have non-empty emoji. Got: "${reaction.emoji}".`,
                            );

                            // Each entry must have count > 0
                            assert.ok(
                                typeof reaction.count === 'number' && reaction.count > 0,
                                `Normalized reaction "${reaction.emoji}" must have count > 0. ` +
                                `Got: ${reaction.count}.`,
                            );

                            // Each entry must have boolean viewerReacted
                            assert.ok(
                                typeof reaction.viewerReacted === 'boolean',
                                `Normalized reaction "${reaction.emoji}" must have boolean ` +
                                `viewerReacted. Got: ${typeof reaction.viewerReacted}.`,
                            );
                        }

                        // No duplicate emojis
                        const emojis = normalized.map((r) => r.emoji);
                        const uniqueEmojis = new Set(emojis);
                        assert.strictEqual(
                            emojis.length,
                            uniqueEmojis.size,
                            `Normalized result has duplicate emojis: [${emojis.join(', ')}].`,
                        );
                    },
                ),
                { numRuns: 20 },
            );
        });
    });
});
