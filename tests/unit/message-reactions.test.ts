import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildReactionSummaryByMessage,
    normalizeMessageReactionSummary,
    toPersistedReactionSummary,
    toggleMessageReactionSummary,
    withReactionSummaryMetadata,
} from '@/lib/messages/reactions';

test('buildReactionSummaryByMessage groups rows per message and marks the viewer reaction', () => {
    const summary = buildReactionSummaryByMessage([
        { messageId: 'message-1', emoji: '🔥', userId: 'user-1' },
        { messageId: 'message-1', emoji: '🔥', userId: 'user-2' },
        { messageId: 'message-1', emoji: '👍', userId: 'user-3' },
        { messageId: 'message-2', emoji: '😀', userId: 'user-2' },
    ], 'user-2');

    assert.deepEqual(summary['message-1'], [
        { emoji: '🔥', count: 2, viewerReacted: true },
        { emoji: '👍', count: 1, viewerReacted: false },
    ]);
    assert.deepEqual(summary['message-2'], [
        { emoji: '😀', count: 1, viewerReacted: true },
    ]);
});

test('normalizeMessageReactionSummary accepts legacy reacted keys and merges duplicates', () => {
    const normalized = normalizeMessageReactionSummary([
        { emoji: '🔥', count: 1, reacted: true },
        { emoji: '🔥', count: 2, viewerReacted: false },
        { emoji: '👍', count: 0, viewerReacted: true },
        { emoji: '', count: 1, viewerReacted: true },
    ]);

    assert.deepEqual(normalized, [
        { emoji: '🔥', count: 3, viewerReacted: true },
    ]);
});

test('toggleMessageReactionSummary applies optimistic add and remove deterministically', () => {
    const base = [
        { emoji: '🔥', count: 2, viewerReacted: false },
        { emoji: '😀', count: 1, viewerReacted: true },
    ];

    assert.deepEqual(toggleMessageReactionSummary(base, '🔥'), [
        { emoji: '🔥', count: 3, viewerReacted: true },
        { emoji: '😀', count: 1, viewerReacted: true },
    ]);

    assert.deepEqual(toggleMessageReactionSummary(base, '😀'), [
        { emoji: '🔥', count: 2, viewerReacted: false },
    ]);
});

test('withReactionSummaryMetadata removes empty summaries and stores normalized values', () => {
    const withSummary = withReactionSummaryMetadata(
        { deliveryState: 'sent' },
        [
            { emoji: '🔥', count: 2, viewerReacted: false },
            { emoji: '🔥', count: 1, viewerReacted: true },
        ],
    );

    assert.deepEqual(withSummary, {
        deliveryState: 'sent',
        reactionSummary: [
            { emoji: '🔥', count: 3, viewerReacted: true },
        ],
    });

    assert.deepEqual(
        withReactionSummaryMetadata(withSummary, []),
        { deliveryState: 'sent' },
    );
});

test('toPersistedReactionSummary removes viewer-specific reaction state', () => {
    assert.deepEqual(
        toPersistedReactionSummary([
            { emoji: '🔥', count: 2, viewerReacted: true },
            { emoji: '👍', count: 1, viewerReacted: false },
        ]),
        [
            { emoji: '🔥', count: 2, viewerReacted: false },
            { emoji: '👍', count: 1, viewerReacted: false },
        ],
    );
});
