import test from 'node:test'
import assert from 'node:assert/strict'

import { createPresenceStore } from '../../services/presence/src/store'

test('createPresenceStore falls back to in-memory transport outside production', () => {
    const presenceStore = createPresenceStore({
        env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
        redisClient: null,
    })

    assert.equal(presenceStore.mode, 'memory')
})

test('createPresenceStore requires Redis in production', () => {
    assert.throws(() => createPresenceStore({
        env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv,
        redisClient: null,
    }), /Upstash Redis is required/i)
})

test('in-memory presence store preserves hash and publish semantics', async () => {
    const presenceStore = createPresenceStore({
        env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
        redisClient: null,
    })
    const { store } = presenceStore

    await store.hset('presence:room:test:members_v2', {
        'member-1': JSON.stringify({ userId: 'user-1', typing: true }),
    })

    const members = await store.hgetall<Record<string, string>>('presence:room:test:members_v2')
    assert.equal(typeof members?.['member-1'], 'string')

    let receivedMessage: string | null = null
    const subscriber = store.subscribe<string>('presence:room:test:events')
    subscriber.on('message', (event: { message?: string }) => {
        receivedMessage = event.message ?? null
    })

    await store.publish('presence:room:test:events', '{"type":"presence.delta"}')
    assert.equal(receivedMessage, '{"type":"presence.delta"}')

    await subscriber.unsubscribe()
})

