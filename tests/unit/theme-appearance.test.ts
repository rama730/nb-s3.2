import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_STORAGE_KEYS,
  choosePreferredSnapshot,
  createAppearanceSnapshot,
  DEFAULT_APPEARANCE_SNAPSHOT,
  parseAppearanceSnapshot,
  readLocalAppearanceSnapshot,
  resolveThemeMode,
  buildThemePrehydrateScript,
} from "../../src/lib/theme/appearance";

test("parseAppearanceSnapshot accepts valid snapshot payload", () => {
  const parsed = parseAppearanceSnapshot({
    version: 1,
    theme: "dark",
    accentColor: "teal",
    density: "comfortable",
    reduceMotion: true,
    updatedAt: "2026-03-10T00:00:00.000Z",
  });

  assert.ok(parsed);
  assert.equal(parsed?.theme, "dark");
  assert.equal(parsed?.accentColor, "teal");
  assert.equal(parsed?.density, "comfortable");
  assert.equal(parsed?.reduceMotion, true);
});

test("parseAppearanceSnapshot rejects invalid payload", () => {
  const parsed = parseAppearanceSnapshot({
    theme: "invalid",
    accentColor: "teal",
    density: "default",
    reduceMotion: "yes",
  });
  assert.equal(parsed, null);
});

test("readLocalAppearanceSnapshot prefers unified snapshot key", () => {
  const nowIso = "2026-03-10T12:00:00.000Z";
  const store = new Map<string, string>();
  store.set(
    APPEARANCE_STORAGE_KEYS.snapshot,
    JSON.stringify({
      version: 1,
      theme: "dark",
      accentColor: "pink",
      density: "compact",
      reduceMotion: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
    }),
  );

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.theme, "dark");
  assert.equal(snapshot.accentColor, "pink");
  assert.equal(snapshot.density, "compact");
  assert.equal(snapshot.reduceMotion, true);
});

test("readLocalAppearanceSnapshot falls back to legacy keys", () => {
  const nowIso = "2026-03-10T12:00:00.000Z";
  const store = new Map<string, string>([
    [APPEARANCE_STORAGE_KEYS.theme, "light"],
    [APPEARANCE_STORAGE_KEYS.accent, "green"],
    [APPEARANCE_STORAGE_KEYS.density, "comfortable"],
    [APPEARANCE_STORAGE_KEYS.reduceMotion, "true"],
  ]);

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.theme, "light");
  assert.equal(snapshot.accentColor, "green");
  assert.equal(snapshot.density, "comfortable");
  assert.equal(snapshot.reduceMotion, true);
  assert.equal(snapshot.updatedAt, nowIso);
});

test("choosePreferredSnapshot keeps newest snapshot", () => {
  const local = createAppearanceSnapshot({
    ...DEFAULT_APPEARANCE_SNAPSHOT,
    theme: "light",
    updatedAt: "2026-03-09T00:00:00.000Z",
  });
  const remote = createAppearanceSnapshot({
    ...DEFAULT_APPEARANCE_SNAPSHOT,
    theme: "dark",
    updatedAt: "2026-03-10T00:00:00.000Z",
  });

  const preferred = choosePreferredSnapshot(local, remote);
  assert.equal(preferred.theme, "dark");
});

test("resolveThemeMode resolves system mode against device preference", () => {
  assert.equal(resolveThemeMode("system", true), "dark");
  assert.equal(resolveThemeMode("system", false), "light");
  assert.equal(resolveThemeMode("dark", false), "dark");
});

test("buildThemePrehydrateScript includes core storage keys", () => {
  const script = buildThemePrehydrateScript();
  assert.ok(script.includes(APPEARANCE_STORAGE_KEYS.snapshot));
  assert.ok(script.includes(APPEARANCE_STORAGE_KEYS.theme));
  assert.ok(script.includes("data-accent"));
  assert.ok(script.includes("data-density"));
});
