import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { requestUsernameAvailability, resetUsernameAvailabilityCache } from '@/hooks/useUsernameAvailability'

const originalFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = originalFetch
    resetUsernameAvailabilityCache()
})

test('requestUsernameAvailability dedupes in-flight requests for the same username', async () => {
    let callCount = 0
    globalThis.fetch = (async () => {
        callCount += 1
        return new Response(JSON.stringify({ available: true, message: 'Username is available!' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    }) as typeof fetch

    const [first, second] = await Promise.all([
        requestUsernameAvailability('Builder_42'),
        requestUsernameAvailability('builder_42'),
    ])

    assert.equal(callCount, 1)
    assert.equal(first.payload.available, true)
    assert.equal(second.payload.available, true)
})

test('requestUsernameAvailability caches successful lookups', async () => {
    let callCount = 0
    globalThis.fetch = (async () => {
        callCount += 1
        return new Response(JSON.stringify({ available: false, message: 'Username is unavailable', code: 'USERNAME_RESERVED' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    }) as typeof fetch

    const first = await requestUsernameAvailability('edge')
    const second = await requestUsernameAvailability('edge')

    assert.equal(callCount, 1)
    assert.equal(first.payload.code, 'USERNAME_RESERVED')
    assert.equal(second.payload.code, 'USERNAME_RESERVED')
})
