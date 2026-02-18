import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateCooldown,
    normalizeApplicationMessageText,
    resolveLifecycleStatus,
} from '@/lib/applications/utils';

test('calculateCooldown returns canApply when elapsed exceeds cooldown window', () => {
    const now = new Date('2026-02-17T12:00:00.000Z').getTime();
    const updatedAt = new Date(now - 25 * 60 * 60 * 1000);
    assert.deepEqual(calculateCooldown(updatedAt, now), { canApply: true });
});

test('calculateCooldown returns wait time when still in cooldown window', () => {
    const now = new Date('2026-02-17T12:00:00.000Z').getTime();
    const updatedAt = new Date(now - (2 * 60 * 60 * 1000 + 30 * 60 * 1000));
    const result = calculateCooldown(updatedAt, now);
    assert.equal(result.canApply, false);
    assert.equal(result.waitTime, '21h 30m');
});

test('normalizeApplicationMessageText normalizes link + availability and de-duplicates', () => {
    const raw = `
        I can contribute now.
        github.com/example/repo
        Availability: 15 hrs/week
        github.com/example/repo
    `;

    const normalized = normalizeApplicationMessageText(raw);
    assert.match(normalized, /I can contribute now\./);
    assert.match(normalized, /GitHub: https:\/\/github\.com\/example\/repo/);
    assert.match(normalized, /Availability: 15 hrs\/week/);
    const occurrences = normalized.split('GitHub: https://github.com/example/repo').length - 1;
    assert.equal(occurrences, 1);
});

test('resolveLifecycleStatus handles known terminal reasons', () => {
    assert.equal(resolveLifecycleStatus('pending', null), 'pending');
    assert.equal(resolveLifecycleStatus('accepted', null), 'accepted');
    assert.equal(resolveLifecycleStatus('rejected', 'withdrawn_by_applicant'), 'withdrawn');
    assert.equal(resolveLifecycleStatus('rejected', 'role_filled'), 'role_filled');
    assert.equal(resolveLifecycleStatus('rejected', 'cancelled'), 'rejected');
    assert.equal(resolveLifecycleStatus('rejected', 'other_reason'), 'rejected');
});
