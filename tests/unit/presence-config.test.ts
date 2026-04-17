import test from 'node:test'
import assert from 'node:assert/strict'

import { resolvePresenceWebSocketUrl } from '@/lib/realtime/presence-config'

function makeEnv(values: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv
}

test('resolvePresenceWebSocketUrl prefers an explicit URL', () => {
    assert.equal(
        resolvePresenceWebSocketUrl({
            preferredUrl: 'ws://presence.example/ws/',
            env: makeEnv({}),
        }),
        'ws://presence.example/ws',
    )
})

test('resolvePresenceWebSocketUrl uses configured environment URLs', () => {
    assert.equal(
        resolvePresenceWebSocketUrl({
            env: makeEnv({
                NEXT_PUBLIC_PRESENCE_WS_URL: 'wss://presence.example/ws/',
            }),
        }),
        'wss://presence.example/ws',
    )
})

test('resolvePresenceWebSocketUrl falls back to the local presence service in development', () => {
    assert.equal(
        resolvePresenceWebSocketUrl({
            env: makeEnv({
                NODE_ENV: 'development',
                PRESENCE_SERVICE_PORT: '4444',
            }),
        }),
        'ws://127.0.0.1:4444/ws',
    )
})

test('resolvePresenceWebSocketUrl stays empty in production without explicit configuration', () => {
    assert.equal(
        resolvePresenceWebSocketUrl({
            env: makeEnv({
                NODE_ENV: 'production',
                PRESENCE_SERVICE_PORT: '4444',
            }),
            hostname: 'app.edge.example',
        }),
        null,
    )
})

test('resolvePresenceWebSocketUrl ignores disabled placeholder hosts in development and falls back locally', () => {
    assert.equal(
        resolvePresenceWebSocketUrl({
            env: makeEnv({
                NODE_ENV: 'development',
                PRESENCE_SERVICE_PORT: '4010',
                PRESENCE_WS_URL: 'wss://presence.local.invalid/socket',
            }),
            hostname: 'localhost',
        }),
        'ws://127.0.0.1:4010/ws',
    )
})
