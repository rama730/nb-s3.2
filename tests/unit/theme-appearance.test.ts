import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_STORAGE_KEYS,
  areAppearanceSnapshotsEquivalent,
  choosePreferredSnapshot,
  createAppearanceSnapshot,
  DEFAULT_APPEARANCE_SNAPSHOT,
  parseAppearanceSnapshot,
  readLocalAppearanceSnapshot,
  resolveThemeMode,
  buildThemePrehydrateScript,
} from "../../src/lib/theme/appearance";
import {
  ACCENT_PALETTES,
  getAccentSwatchBackground,
  resolveReducedMotionPreference,
} from "../../src/lib/theme/appearance-runtime";

test("parseAppearanceSnapshot accepts valid snapshot payload", () => {
  const parsed = parseAppearanceSnapshot({
    version: 1,
    theme: "dark",
    accentColor: "lagoon",
    density: "comfortable",
    reduceMotion: true,
    updatedAt: "2026-03-10T00:00:00.000Z",
  });

  assert.ok(parsed);
  assert.equal(parsed?.theme, "dark");
  assert.equal(parsed?.accentColor, "lagoon");
  assert.equal(parsed?.density, "comfortable");
  assert.equal(parsed?.reduceMotion, true);
});

test("parseAppearanceSnapshot rejects invalid payload", () => {
  const parsed = parseAppearanceSnapshot({
    theme: "invalid",
    accentColor: "lagoon",
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
      accentColor: "rose",
      density: "compact",
      reduceMotion: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
    }),
  );

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.theme, "dark");
  assert.equal(snapshot.accentColor, "rose");
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
  assert.equal(snapshot.accentColor, "forest");
  assert.equal(snapshot.density, "comfortable");
  assert.equal(snapshot.reduceMotion, true);
  assert.equal(snapshot.updatedAt, nowIso);
});

test("readLocalAppearanceSnapshot normalizes legacy accent aliases", () => {
  const nowIso = "2026-03-10T12:00:00.000Z";
  const store = new Map<string, string>([
    [APPEARANCE_STORAGE_KEYS.snapshot, JSON.stringify({
      version: 1,
      theme: "light",
      accentColor: "purple",
      density: "default",
      reduceMotion: false,
      updatedAt: "2026-03-09T10:00:00.000Z",
    })],
  ]);

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.accentColor, "orchid");
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

test("areAppearanceSnapshotsEquivalent ignores updatedAt when values match", () => {
  const first = createAppearanceSnapshot({
    ...DEFAULT_APPEARANCE_SNAPSHOT,
    theme: "dark",
    updatedAt: "2026-03-10T00:00:00.000Z",
  });
  const second = createAppearanceSnapshot({
    ...DEFAULT_APPEARANCE_SNAPSHOT,
    theme: "dark",
    updatedAt: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(areAppearanceSnapshotsEquivalent(first, second), true);
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

test("accent palette metadata exposes dual-color palette ids", () => {
  assert.deepEqual(Object.keys(ACCENT_PALETTES), [
    "default",
    "orchid",
    "forest",
    "ember",
    "rose",
    "lagoon",
  ]);
});

test("accent palette metadata exposes solid action color and selected tint", () => {
  assert.equal(ACCENT_PALETTES.default.solid, "#5b3df5");
  assert.equal(ACCENT_PALETTES.default.selectedTint, "#dfe9ff");
});

test("getAccentSwatchBackground renders a solid swatch with a lighter selected-surface cue", () => {
  const background = getAccentSwatchBackground("default");
  assert.match(background, /radial-gradient\(circle at 72% 28%,/);
  assert.match(background, /#dfe9ff/);
  assert.match(background, /#5b3df5/);
});

test("resolveReducedMotionPreference honors app and system reduced-motion inputs", () => {
  const rootWithAppPreference = {
    getAttribute: (name: string) => (name === "data-reduce-motion" ? "true" : null),
  } as unknown as Element;

  const rootWithoutAppPreference = {
    getAttribute: () => null,
  } as unknown as Element;

  assert.equal(
    resolveReducedMotionPreference({
      root: rootWithoutAppPreference,
      matchMedia: () => ({ matches: false } as MediaQueryList),
    }),
    false,
  );

  assert.equal(
    resolveReducedMotionPreference({
      root: rootWithAppPreference,
      matchMedia: () => ({ matches: false } as MediaQueryList),
    }),
    true,
  );

  assert.equal(
    resolveReducedMotionPreference({
      root: rootWithoutAppPreference,
      matchMedia: () => ({ matches: true } as MediaQueryList),
    }),
    true,
  );
});
