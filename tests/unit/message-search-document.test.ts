import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMessageSearchDocument } from '@/lib/messages/search-document';

test('buildMessageSearchDocument combines plain content and structured metadata', () => {
    const document = buildMessageSearchDocument({
        content: 'Need review',
        metadata: {
            structured: {
                kind: 'feedback_request',
                version: 1,
                layout: 'minimal_card',
                title: 'Feedback request',
                summary: 'Please review the onboarding copy',
                contextChips: [],
                entityRefs: {},
            },
        },
    });

    assert.equal(document, 'Need review Feedback request Please review the onboarding copy');
});

test('buildMessageSearchDocument stays stable for plain messages', () => {
    const document = buildMessageSearchDocument({
        content: '  plain   text   message  ',
        metadata: null,
    });

    assert.equal(document, 'plain text message');
});
