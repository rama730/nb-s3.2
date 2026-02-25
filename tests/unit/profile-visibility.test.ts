import test from 'node:test'
import assert from 'node:assert/strict'
import { canViewerAccessProfile } from '@/lib/security/profile-visibility'

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
