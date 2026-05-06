import assert from "node:assert/strict";
import test from "node:test";

function validateSnoozeUntil(input: string): { ok: true; date: Date } | { ok: false; reason: string } {
    const until = new Date(input);
    if (Number.isNaN(until.getTime())) {
        return { ok: false, reason: "invalid" };
    }
    if (until.getTime() <= Date.now()) {
        return { ok: false, reason: "past" };
    }
    return { ok: true, date: until };
}

test("snooze validation rejects non-ISO strings", () => {
    const result = validateSnoozeUntil("not-a-date");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
});

test("snooze validation rejects past timestamps", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = validateSnoozeUntil(past);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "past");
});

test("snooze validation rejects now() exactly", () => {
    const now = new Date(Date.now()).toISOString();
    const result = validateSnoozeUntil(now);
    assert.equal(result.ok, false);
});

test("snooze validation accepts future timestamps", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const result = validateSnoozeUntil(future);
    assert.equal(result.ok, true);
});

function snoozePresets(now: Date) {
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const tomorrowMorning = new Date(now);
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
    tomorrowMorning.setHours(9, 0, 0, 0);
    const nextMondayMorning = new Date(now);
    const daysUntilMonday = ((8 - nextMondayMorning.getDay()) % 7) || 7;
    nextMondayMorning.setDate(nextMondayMorning.getDate() + daysUntilMonday);
    nextMondayMorning.setHours(9, 0, 0, 0);
    return { inOneHour, tomorrowMorning, nextMondayMorning };
}

test("snooze presets produce strictly future timestamps from a Wednesday afternoon", () => {
    const wednesdayAfternoon = new Date("2026-04-22T14:30:00.000Z");
    const presets = snoozePresets(wednesdayAfternoon);
    assert.ok(presets.inOneHour.getTime() > wednesdayAfternoon.getTime());
    assert.ok(presets.tomorrowMorning.getTime() > wednesdayAfternoon.getTime());
    assert.ok(presets.nextMondayMorning.getTime() > wednesdayAfternoon.getTime());
});

test("snooze 'next week' from a Monday yields the FOLLOWING Monday, never today", () => {
    const monday = new Date(2026, 3, 20, 8, 0, 0, 0);
    const presets = snoozePresets(monday);
    const diffDays = Math.round((presets.nextMondayMorning.getTime() - monday.getTime()) / (24 * 60 * 60 * 1000));
    assert.ok(diffDays >= 6, `expected next Monday to be ≥6 days out, got ${diffDays}`);
});

test("snooze 'tomorrow' is always 9am local, not now+24h", () => {
    const lateNight = new Date();
    lateNight.setHours(23, 45, 0, 0);
    const presets = snoozePresets(lateNight);
    assert.equal(presets.tomorrowMorning.getHours(), 9);
    assert.equal(presets.tomorrowMorning.getMinutes(), 0);
});
