import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatMessageCalendarLabel,
    getMessageCalendarDay,
} from '@/lib/messages/date-buckets';

test('message date buckets use the viewer calendar day, not the UTC day', () => {
    const sentAt = '2026-05-01T23:33:18.464Z';
    const now = '2026-05-02T00:14:00.000Z';
    const day = getMessageCalendarDay(sentAt, 'Asia/Kolkata');

    assert.equal(day.key, '2026-05-02');
    assert.equal(formatMessageCalendarLabel(day.key, { now, timeZone: 'Asia/Kolkata' }), 'Today');
});

test('message date buckets still label true previous-day messages as yesterday', () => {
    const sentAt = '2026-05-01T10:00:00.000Z';
    const now = '2026-05-02T00:14:00.000Z';
    const day = getMessageCalendarDay(sentAt, 'Asia/Kolkata');

    assert.equal(day.key, '2026-05-01');
    assert.equal(formatMessageCalendarLabel(day.key, { now, timeZone: 'Asia/Kolkata' }), 'Yesterday');
});
