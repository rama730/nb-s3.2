import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildJourneyCompletionDates,
    formatJourneyCompletionDate,
    getStageCompletionTooltip,
    normalizeJourneyCompletionDates,
} from '@/lib/projects/journey-completion';

test('journey completion dates use a stable UTC calendar date', () => {
    assert.equal(formatJourneyCompletionDate('2026-08-30T23:30:00-07:00'), 'Aug 31, 2026');
    assert.equal(getStageCompletionTooltip('2026-08-30T23:30:00-07:00'), 'Finished on Aug 31, 2026');
});

test('missing or invalid legacy history never borrows a mutable project update date', () => {
    assert.equal(getStageCompletionTooltip(), 'Finished — date not recorded');
    assert.equal(getStageCompletionTooltip('invalid'), 'Finished — date not recorded');
});

test('completion-date normalization retains only valid completed-stage timestamps', () => {
    assert.deepEqual(normalizeJourneyCompletionDates({
        0: '2026-08-20T12:00:00Z',
        1: 'invalid',
        2: '2026-08-22T12:00:00Z',
        3: '2026-08-23T12:00:00Z',
        extra: '2026-08-24T12:00:00Z',
    }, 3), {
        0: '2026-08-20T12:00:00.000Z',
        2: '2026-08-22T12:00:00.000Z',
    });
});

test('forward transitions stamp every newly crossed stage exactly once', () => {
    assert.deepEqual(buildJourneyCompletionDates({
        completionDates: { 0: '2026-08-20T12:00:00Z' },
        previousStageIndex: 2,
        nextStageIndex: 4,
        transitionedAt: '2026-08-30T12:34:56Z',
    }), {
        0: '2026-08-20T12:00:00.000Z',
        2: '2026-08-30T12:34:56.000Z',
        3: '2026-08-30T12:34:56.000Z',
    });
});

test('redo transitions discard timestamps for reopened stages', () => {
    assert.deepEqual(buildJourneyCompletionDates({
        completionDates: {
            0: '2026-08-20T12:00:00Z',
            1: '2026-08-21T12:00:00Z',
            2: '2026-08-22T12:00:00Z',
            3: '2026-08-23T12:00:00Z',
        },
        previousStageIndex: 4,
        nextStageIndex: 2,
        transitionedAt: '2026-08-30T12:34:56Z',
    }), {
        0: '2026-08-20T12:00:00.000Z',
        1: '2026-08-21T12:00:00.000Z',
    });
});
