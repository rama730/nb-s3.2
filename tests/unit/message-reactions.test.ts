import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildReactionDetails,
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

test('buildReactionDetails groups rows by emoji with per-user attribution', () => {
    const rows = [
        { userId: 'user-1', username: 'Alice', avatarUrl: 'https://img/alice.png', emoji: '👍', createdAt: new Date('2024-01-01T10:00:00Z') },
        { userId: 'user-2', username: 'Bob', avatarUrl: null, emoji: '👍', createdAt: new Date('2024-01-01T10:01:00Z') },
        { userId: 'user-3', username: 'Charlie', avatarUrl: 'https://img/charlie.png', emoji: '❤️', createdAt: new Date('2024-01-01T10:02:00Z') },
        { userId: 'user-1', username: 'Alice', avatarUrl: 'https://img/alice.png', emoji: '❤️', createdAt: new Date('2024-01-01T10:03:00Z') },
    ];

    const result = buildReactionDetails(rows);

    assert.equal(result.length, 2);
    // 👍 has 2 users, ❤️ has 2 users — sorted by count desc then emoji
    assert.equal(result[0].emoji, '❤️');
    assert.equal(result[0].users.length, 2);
    assert.equal(result[1].emoji, '👍');
    assert.equal(result[1].users.length, 2);

    // Users sorted by createdAt ascending
    assert.equal(result[1].users[0].userId, 'user-1');
    assert.equal(result[1].users[0].username, 'Alice');
    assert.equal(result[1].users[1].userId, 'user-2');
    assert.equal(result[1].users[1].username, 'Bob');
    assert.equal(result[1].users[1].avatarUrl, null);
});

test('buildReactionDetails deduplicates same user + emoji', () => {
    const rows = [
        { userId: 'user-1', username: 'Alice', avatarUrl: null, emoji: '👍', createdAt: new Date('2024-01-01T10:00:00Z') },
        { userId: 'user-1', username: 'Alice', avatarUrl: null, emoji: '👍', createdAt: new Date('2024-01-01T10:05:00Z') },
    ];

    const result = buildReactionDetails(rows);

    assert.equal(result.length, 1);
    assert.equal(result[0].emoji, '👍');
    assert.equal(result[0].users.length, 1);
});

test('buildReactionDetails handles empty rows', () => {
    assert.deepEqual(buildReactionDetails([]), []);
});

test('buildReactionDetails skips rows with empty emoji or userId', () => {
    const rows = [
        { userId: '', username: 'Ghost', avatarUrl: null, emoji: '👍', createdAt: new Date('2024-01-01T10:00:00Z') },
        { userId: 'user-1', username: 'Alice', avatarUrl: null, emoji: '  ', createdAt: new Date('2024-01-01T10:00:00Z') },
        { userId: 'user-2', username: 'Bob', avatarUrl: null, emoji: '🔥', createdAt: new Date('2024-01-01T10:00:00Z') },
    ];

    const result = buildReactionDetails(rows);

    assert.equal(result.length, 1);
    assert.equal(result[0].emoji, '🔥');
    assert.equal(result[0].users[0].userId, 'user-2');
});

test('buildReactionDetails accepts string dates and converts to Date objects', () => {
    const rows = [
        { userId: 'user-1', username: 'Alice', avatarUrl: null, emoji: '👍', createdAt: '2024-01-01T10:00:00Z' },
    ];

    const result = buildReactionDetails(rows);

    assert.equal(result[0].users[0].createdAt instanceof Date, true);
    assert.equal(result[0].users[0].createdAt.toISOString(), '2024-01-01T10:00:00.000Z');
});
