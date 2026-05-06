import test from 'node:test'
import assert from 'node:assert/strict'

import { createPresenceStore, type PresenceStore } from '../../services/presence/src/store'

const fakeRedisClient = {
    set: async () => 'OK',
    get: async () => null,
    del: async () => 1,
    hset: async () => 1,
    expire: async () => 1,
    hdel: async () => 1,
    hgetall: async () => null,
    hlen: async () => 0,
    publish: async () => 0,
    subscribe: () => ({
        on: () => undefined,
        unsubscribe: async () => undefined,
    }),
} satisfies PresenceStore

test('createPresenceStore falls back to in-memory transport outside production', () => {
    const presenceStore = createPresenceStore({
        env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
        redisClient: null,
    })

    assert.equal(presenceStore.mode, 'memory')
})

test('createPresenceStore defaults to in-memory transport in development even when Redis is configured', () => {
    const presenceStore = createPresenceStore({
        env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
        redisClient: fakeRedisClient,
    })

    assert.equal(presenceStore.mode, 'memory')
})

test('createPresenceStore can opt into Redis transport outside production', () => {
    const presenceStore = createPresenceStore({
        env: {
            NODE_ENV: 'development',
            PRESENCE_STORE_MODE: 'redis',
        } as NodeJS.ProcessEnv,
        redisClient: fakeRedisClient,
    })

    assert.equal(presenceStore.mode, 'redis')
})

test('createPresenceStore requires Redis in production', () => {
    assert.throws(() => createPresenceStore({
        env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv,
        redisClient: null,
    }), /Upstash Redis is required/i)
})

test('createPresenceStore rejects in-memory transport in production', () => {
    assert.throws(() => createPresenceStore({
        env: {
            NODE_ENV: 'production',
            PRESENCE_STORE_MODE: 'memory',
        } as NodeJS.ProcessEnv,
        redisClient: null,
    }), /in-memory presence transport is not allowed/i)
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
