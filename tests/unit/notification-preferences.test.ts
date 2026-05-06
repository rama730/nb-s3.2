import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  formatMinuteOfDay,
  getNotificationPauseUntil,
  getQuietHoursResumeAt,
  isQuietHoursActive,
  normalizeNotificationPreferences,
  parseTimeInput,
} from "@/lib/notifications/preferences";

test("normalizeNotificationPreferences returns canonical defaults for missing data", () => {
  assert.deepEqual(normalizeNotificationPreferences(null), DEFAULT_NOTIFICATION_PREFERENCES);
  assert.deepEqual(normalizeNotificationPreferences("not-json"), DEFAULT_NOTIFICATION_PREFERENCES);
});

test("normalizeNotificationPreferences preserves explicit category choices", () => {
  assert.deepEqual(normalizeNotificationPreferences({
    messages: false,
    mentions: true,
    workflows: false,
    projects: true,
    tasks: false,
    applications: false,
    connections: true,
    ignoredLegacyKey: true,
  }), {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    messages: false,
    mentions: true,
    workflows: false,
    projects: true,
    tasks: false,
    applications: false,
    connections: true,
  });
});

test("normalizeNotificationPreferences fills newly added categories from defaults", () => {
  assert.deepEqual(normalizeNotificationPreferences({
    messages: false,
    mentions: false,
  }), {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    messages: false,
    mentions: false,
  });
});

test("normalizeNotificationPreferences fills in default quiet hours and clamps bad input", () => {
  const withDefaults = normalizeNotificationPreferences({});
  assert.deepEqual(withDefaults.quietHours, DEFAULT_NOTIFICATION_PREFERENCES.quietHours);

  const withBad = normalizeNotificationPreferences({
    quietHours: { enabled: true, startMinute: -100, endMinute: 9999 },
  });
  assert.deepEqual(withBad.quietHours, { enabled: true, startMinute: 0, endMinute: 1439 });
});

test("isQuietHoursActive respects wraparound windows", () => {
  const prefs = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
  };
  // 23:30 falls inside 22:00 → 07:00 window
  assert.equal(isQuietHoursActive(prefs, new Date(2026, 3, 21, 23, 30)), true);
  // 03:00 falls inside wraparound window
  assert.equal(isQuietHoursActive(prefs, new Date(2026, 3, 21, 3, 0)), true);
  // 12:00 is outside
  assert.equal(isQuietHoursActive(prefs, new Date(2026, 3, 21, 12, 0)), false);
});

test("quiet controls return the next delivery resume time", () => {
  const pausedUntil = "2026-04-21T12:00:00.000Z";
  const paused = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    pausedUntil,
  };
  assert.equal(getNotificationPauseUntil(paused, new Date("2026-04-21T08:00:00.000Z"))?.toISOString(), pausedUntil);

  const quiet = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
  };
  const resumeFromNight = getQuietHoursResumeAt(quiet, new Date(2026, 3, 21, 23, 30));
  assert.equal(resumeFromNight?.getFullYear(), 2026);
  assert.equal(resumeFromNight?.getMonth(), 3);
  assert.equal(resumeFromNight?.getDate(), 22);
  assert.equal(resumeFromNight?.getHours(), 7);
  assert.equal(resumeFromNight?.getMinutes(), 0);
});

test("isQuietHoursActive off when disabled or identical bounds", () => {
  const disabled = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quietHours: { enabled: false, startMinute: 0, endMinute: 600 },
  };
  assert.equal(isQuietHoursActive(disabled, new Date(2026, 3, 21, 3, 0)), false);

  const sameBound = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quietHours: { enabled: true, startMinute: 720, endMinute: 720 },
  };
  assert.equal(isQuietHoursActive(sameBound, new Date(2026, 3, 21, 12, 0)), false);
});

test("formatMinuteOfDay and parseTimeInput round-trip HH:MM", () => {
  assert.equal(formatMinuteOfDay(0), "00:00");
  assert.equal(formatMinuteOfDay(22 * 60 + 30), "22:30");
  assert.equal(parseTimeInput("07:15"), 7 * 60 + 15);
  assert.equal(parseTimeInput("9:05"), 9 * 60 + 5);
  assert.equal(parseTimeInput("25:00"), null);
  assert.equal(parseTimeInput("not-a-time"), null);
});

test("normalizeNotificationPreferences applies default delivery + honors explicit values", () => {
  const withDefaults = normalizeNotificationPreferences({});
  assert.deepEqual(withDefaults.delivery, DEFAULT_NOTIFICATION_PREFERENCES.delivery);

  const withExplicit = normalizeNotificationPreferences({
    delivery: { browser: true, push: true, emailDigest: false, somethingElse: "x" },
  });
  assert.deepEqual(withExplicit.delivery, { browser: true, push: true, emailDigest: false });

  const withBad = normalizeNotificationPreferences({ delivery: "not-an-object" });
  assert.deepEqual(withBad.delivery, DEFAULT_NOTIFICATION_PREFERENCES.delivery);
});

test("normalizeNotificationPreferences preserves pause and dedupes muted scopes", () => {
  const normalized = normalizeNotificationPreferences({
    pausedUntil: "2026-04-21T12:00:00.000Z",
    mutedScopes: [
      { kind: "kind", value: "message_burst", label: "Messages" },
      { kind: "notification_type", value: "message_burst", label: "Messages duplicate" },
      { kind: "unknown", value: "bad" },
    ],
  });

  assert.equal(normalized.pausedUntil, "2026-04-21T12:00:00.000Z");
  assert.deepEqual(normalized.mutedScopes, [
    { kind: "notification_type", value: "message_burst", label: "Messages duplicate", mutedAt: null },
  ]);
});
