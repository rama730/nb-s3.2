import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSafeExternalUrl, parseSafeLinkToken } from '../../src/lib/messages/safe-links';

describe('safe-links', () => {
    test('normalizes bare social links to https', () => {
        const normalized = normalizeSafeExternalUrl('github.com/example-user');
        assert.equal(normalized, 'https://github.com/example-user');
    });

    test('rejects unsafe protocols', () => {
        const normalized = normalizeSafeExternalUrl('javascript:alert(1)');
        assert.equal(normalized, null);
    });

    test('parses safe links with trailing punctuation', () => {
        const parsed = parseSafeLinkToken('https://linkedin.com/in/example),');
        assert.deepEqual(parsed, {
            href: 'https://linkedin.com/in/example',
            display: 'https://linkedin.com/in/example',
            trailing: '),',
        });
    });

    test('rejects domain-prefixed text with whitespace', () => {
        const normalized = normalizeSafeExternalUrl('github.com/ I can contribute immediately');
        assert.equal(normalized, null);
    });

    test('rejects domain-prefixed multiline text', () => {
        const normalized = normalizeSafeExternalUrl('github.com/\nI can contribute immediately');
        assert.equal(normalized, null);
    });

    test('rejects sentence-like token from being treated as link', () => {
        const parsed = parseSafeLinkToken('goals.i have prior experience');
        assert.equal(parsed, null);
    });
});
