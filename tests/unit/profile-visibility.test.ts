import test from 'node:test'
import assert from 'node:assert/strict'
import { canViewerAccessProfile } from '@/lib/security/profile-visibility'
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views'
import { derivePrivacyRelationshipState } from '@/lib/privacy/relationship-state'

test('profile visibility allows owner regardless of visibility', () => {
    assert.equal(canViewerAccessProfile('private', true, false), true)
    assert.equal(canViewerAccessProfile('connections', true, false), true)
})

test('profile visibility blocks private profiles for non-owners', () => {
    assert.equal(canViewerAccessProfile('private', false, false), false)
})

test('profile visibility requires accepted connection for connections-only profiles', () => {
    assert.equal(canViewerAccessProfile('connections', false, false), false)
    assert.equal(canViewerAccessProfile('connections', false, true), true)
})

test('profile visibility allows public profiles', () => {
    assert.equal(canViewerAccessProfile('public', false, false), true)
})

test('profile visibility denies null/undefined visibility for non-owners', () => {
    assert.equal(canViewerAccessProfile(undefined, false, false), false)
    assert.equal(canViewerAccessProfile(null, false, true), false)
})

test('profile visibility allows owner when visibility is null/undefined', () => {
    assert.equal(canViewerAccessProfile(undefined, true, false), true)
    assert.equal(canViewerAccessProfile(null, true, false), true)
})

test('viewer-scoped profile view strips non-display profile fields', () => {
    const relationship = derivePrivacyRelationshipState({
        viewerId: 'viewer-1',
        targetUserId: 'profile-1',
        profileVisibility: 'public',
    })
    const view = buildViewerScopedProfileView({
        relationship,
        profile: {
            id: 'profile-1',
            email: 'private@example.com',
            username: 'builder',
            fullName: 'Builder One',
            notificationPreferences: { messages: true },
            workspaceLayout: { version: 1, widgets: [] },
            workspaceInboxCount: 9,
            bio: 'Public bio',
            visibility: 'public',
            messagePrivacy: 'connections',
            connectionPrivacy: 'everyone',
        },
    }) as Record<string, unknown>

    assert.equal(view.email, undefined)
    assert.equal(view.notificationPreferences, undefined)
    assert.equal(view.workspaceLayout, undefined)
    assert.equal(view.workspaceInboxCount, undefined)
    assert.equal(view.bio, 'Public bio')
})

test('viewer-scoped locked profile keeps only limited identity fields', () => {
    const relationship = derivePrivacyRelationshipState({
        viewerId: 'viewer-1',
        targetUserId: 'profile-1',
        profileVisibility: 'private',
    })
    const view = buildViewerScopedProfileView({
        relationship,
        profile: {
            id: 'profile-1',
            email: 'private@example.com',
            username: 'builder',
            fullName: 'Builder One',
            bio: 'Private bio',
            website: 'https://example.com',
            socialLinks: { github: 'https://github.com/example' },
            skills: ['React'],
            visibility: 'private',
            messagePrivacy: 'connections',
            connectionPrivacy: 'everyone',
        },
    }) as Record<string, unknown>

    assert.equal(view.email, undefined)
    assert.equal(view.username, 'builder')
    assert.equal(view.bio, null)
    assert.deepEqual(view.socialLinks, {})
    assert.deepEqual(view.skills, [])
    assert.equal(view.messagePrivacy, null)
})
