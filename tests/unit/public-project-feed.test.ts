import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    buildPublicProjectsCacheKey,
    decodePublicProjectsCursor,
    encodePublicProjectsCursor,
} from '../../src/lib/projects/public-feed'

describe('public projects feed cursor helpers', () => {
    it('round-trips cursor values', () => {
        const encoded = encodePublicProjectsCursor({
            createdAt: '2026-03-12T10:00:00.000Z',
            id: 'project-123',
        })

        assert.ok(encoded)
        assert.deepEqual(
            decodePublicProjectsCursor(encoded),
            {
                createdAt: '2026-03-12T10:00:00.000Z',
                id: 'project-123',
            },
        )
    })

    it('rejects malformed cursors', () => {
        assert.equal(decodePublicProjectsCursor('not-a-cursor'), null)
        assert.equal(decodePublicProjectsCursor(null), null)
    })

    it('creates stable cache keys for equivalent pages', () => {
        const cursor = {
            createdAt: '2026-03-12T10:00:00.000Z',
            id: 'project-123',
        }

        assert.equal(
            buildPublicProjectsCacheKey(24, cursor),
            'projects:public:v2:limit:24:cursor:2026-03-12T10:00:00.000Z:project-123',
        )
        assert.equal(
            buildPublicProjectsCacheKey(24, null),
            'projects:public:v2:limit:24:cursor:origin',
        )
    })
})
