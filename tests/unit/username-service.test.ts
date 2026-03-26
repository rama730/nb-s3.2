import test from 'node:test'
import assert from 'node:assert/strict'
import {
    UsernamePersistenceError,
    generateDeterministicUsernameCandidates,
    getUsernameAvailability,
    mapUsernamePersistenceError,
    resolvePublicUsernameRoute,
    type UsernameClaim,
    type UsernameRepository,
} from '@/lib/usernames/service'

function createRepo(params: {
    reserved?: string[]
    claims?: UsernameClaim[]
    currentByUserId?: Record<string, string | null>
} = {}): UsernameRepository {
    const reserved = new Set((params.reserved || []).map((value) => value.toLowerCase()))
    const claims = new Map((params.claims || []).map((claim) => [claim.username, claim]))
    const currentByUserId = params.currentByUserId || {}

    return {
        async findReservedUsername(username: string) {
            return reserved.has(username) ? { username } : null
        },
        async findUsernameClaim(username: string) {
            return claims.get(username) || null
        },
        async findCurrentUsernameByUserId(userId: string) {
            return userId in currentByUserId ? { username: currentByUserId[userId] } : null
        },
        async findClaimedUsernames(usernames: string[]) {
            return usernames.filter((username) => claims.has(username))
        },
        async findReservedUsernames(usernames: string[]) {
            return usernames.filter((username) => reserved.has(username))
        },
    }
}

test('getUsernameAvailability rejects reserved usernames from repository', async () => {
    const result = await getUsernameAvailability({
        username: 'edge',
        repo: createRepo({ reserved: ['edge'] }),
    })

    assert.equal(result.available, false)
    assert.equal(result.code, 'USERNAME_RESERVED')
})

test('getUsernameAvailability allows current primary username for the same viewer', async () => {
    const result = await getUsernameAvailability({
        username: 'builder_42',
        viewerId: 'user-1',
        repo: createRepo({
            claims: [{ username: 'builder_42', userId: 'user-1', isPrimary: true }],
        }),
    })

    assert.equal(result.available, true)
})

test('getUsernameAvailability rejects retired aliases even for the same viewer', async () => {
    const result = await getUsernameAvailability({
        username: 'old_builder',
        viewerId: 'user-1',
        repo: createRepo({
            claims: [{ username: 'old_builder', userId: 'user-1', isPrimary: false }],
        }),
    })

    assert.equal(result.available, false)
    assert.equal(result.code, 'USERNAME_TAKEN')
})

test('resolvePublicUsernameRoute redirects historical aliases to the current username', async () => {
    const result = await resolvePublicUsernameRoute({
        username: 'old_builder',
        repo: createRepo({
            claims: [{ username: 'old_builder', userId: 'user-1', isPrimary: false }],
            currentByUserId: { 'user-1': 'builder_42' },
        }),
    })

    assert.deepEqual(result, {
        status: 'redirect',
        normalizedUsername: 'old_builder',
        currentUsername: 'builder_42',
        userId: 'user-1',
        matchedAlias: 'old_builder',
    })
})

test('resolvePublicUsernameRoute redirects case variants to the canonical current username', async () => {
    const result = await resolvePublicUsernameRoute({
        username: 'Builder_42',
        repo: createRepo({
            claims: [{ username: 'builder_42', userId: 'user-1', isPrimary: true }],
        }),
    })

    assert.deepEqual(result, {
        status: 'redirect',
        normalizedUsername: 'builder_42',
        currentUsername: 'builder_42',
        userId: 'user-1',
        matchedAlias: 'builder_42',
    })
})

test('generateDeterministicUsernameCandidates is stable across calls', () => {
    const first = generateDeterministicUsernameCandidates('Ada Lovelace')
    const second = generateDeterministicUsernameCandidates('Ada Lovelace')

    assert.deepEqual(first, second)
    assert.equal(first.length > 0, true)
})

test('mapUsernamePersistenceError preserves explicit username errors', () => {
    const result = mapUsernamePersistenceError(
        new UsernamePersistenceError('USERNAME_RESERVED', 'This username is reserved'),
    )

    assert.equal(result.code, 'USERNAME_RESERVED')
    assert.equal(result.message, 'This username is reserved')
})

test('mapUsernamePersistenceError maps database uniqueness violations to USERNAME_TAKEN', () => {
    const result = mapUsernamePersistenceError({ code: '23505' })

    assert.equal(result.code, 'USERNAME_TAKEN')
    assert.equal(result.message, 'Username is already taken')
})
