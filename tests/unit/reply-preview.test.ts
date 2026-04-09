import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getReplyFocusLabel,
    getReplyPreviewBadge,
    getReplyPreviewText,
    type ReplyPreviewLike,
} from '@/lib/messages/reply-preview';
import { createStructuredMessagePayload } from '@/lib/messages/structured';

function createReplyPreview(overrides: Partial<ReplyPreviewLike> = {}): ReplyPreviewLike {
    return {
        content: 'Original message',
        type: 'text',
        deletedAt: null,
        senderName: 'Rama',
        ...overrides,
    };
}

test('getReplyPreviewBadge returns semantic media and deleted badges', () => {
    assert.equal(getReplyPreviewBadge(createReplyPreview()), null);
    assert.equal(getReplyPreviewBadge(createReplyPreview({ type: 'image', content: null })), 'Photo');
    assert.equal(getReplyPreviewBadge(createReplyPreview({ type: 'file', content: null })), 'File');
    assert.equal(getReplyPreviewBadge(createReplyPreview({ deletedAt: new Date('2026-04-07T12:00:00.000Z') })), 'Deleted');
});

test('getReplyPreviewText returns canonical fallback copy for non-text replies', () => {
    assert.equal(getReplyPreviewText(createReplyPreview()), 'Original message');
    assert.equal(getReplyPreviewText(createReplyPreview({ content: '   Hello there   ' })), 'Hello there');
    assert.equal(getReplyPreviewText(createReplyPreview({ content: null, type: 'image' })), 'Shared a photo');
    assert.equal(getReplyPreviewText(createReplyPreview({ content: null, type: 'video' })), 'Shared a video');
    assert.equal(getReplyPreviewText(createReplyPreview({ content: null, type: 'file' })), 'Shared an attachment');
    assert.equal(
        getReplyPreviewText(createReplyPreview({ deletedAt: new Date('2026-04-07T12:00:00.000Z') })),
        'Message deleted',
    );
});

test('reply preview uses structured metadata when replying to a structured card', () => {
    const structured = createStructuredMessagePayload({
        kind: 'feedback_request',
        title: 'Feedback request',
        summary: 'Please review the current draft',
        stateSnapshot: { status: 'pending', label: 'Pending' },
    });
    assert.ok(structured);

    const reply = createReplyPreview({
        content: null,
        type: 'text',
        metadata: {
            structured,
        },
    });

    assert.equal(getReplyPreviewBadge(reply), 'Feedback request');
    assert.equal(getReplyPreviewText(reply), 'Please review the current draft');
});

test('getReplyFocusLabel distinguishes reply, pin, and external navigation', () => {
    assert.equal(getReplyFocusLabel('reply'), 'Original reply');
    assert.equal(getReplyFocusLabel('pin'), 'Pinned message');
    assert.equal(getReplyFocusLabel('external'), 'Referenced message');
});
