import test from 'node:test'
import assert from 'node:assert/strict'
import {
    isReservedUsername,
    normalizeUsername,
    sanitizeUsernameInput,
    validateUsername,
} from '@/lib/validations/username'

test('normalizeUsername trims and lowercases', () => {
    assert.equal(normalizeUsername('  TeSt_User  '), 'test_user')
})

test('sanitizeUsernameInput strips invalid chars and enforces max length', () => {
    assert.equal(sanitizeUsernameInput('My User!!@name#1234567890'), 'myusername1234567890')
    const longInput = 'User_123456789012345678901234567890'
    const sanitized = sanitizeUsernameInput(longInput)
    assert.equal(sanitized.length <= 20, true)
})

test('validateUsername rejects reserved usernames', () => {
    const result = validateUsername('onboarding')
    assert.equal(result.valid, false)
    assert.equal(result.message, 'This username is reserved')
})

test('validateUsername accepts valid usernames', () => {
    const result = validateUsername('builder_42')
    assert.equal(result.valid, true)
})

test('isReservedUsername normalizes casing and whitespace', () => {
    assert.equal(isReservedUsername(' ADMIN '), true)
    assert.equal(isReservedUsername('OnBoArDiNg'), true)
})
