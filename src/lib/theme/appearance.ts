export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type AccentColor = "default" | "orchid" | "forest" | "ember" | "rose" | "lagoon";
export type Density = "compact" | "default" | "comfortable";

export const APPEARANCE_SNAPSHOT_VERSION = 1 as const;

export interface AppearanceSnapshot {
  version: typeof APPEARANCE_SNAPSHOT_VERSION;
  theme: ThemeMode;
  accentColor: AccentColor;
  density: Density;
  reduceMotion: boolean;
  updatedAt: string;
}

export const APPEARANCE_STORAGE_KEYS = {
  theme: "theme",
  snapshot: "app-appearance-v1",
  accent: "app-accent-color",
  density: "app-density",
  reduceMotion: "app-reduce-motion",
} as const;

const THEME_MODES: ReadonlyArray<ThemeMode> = ["light", "dark", "system"];
const ACCENT_COLORS: ReadonlyArray<AccentColor> = ["default", "orchid", "forest", "ember", "rose", "lagoon"];
const DENSITIES: ReadonlyArray<Density> = ["compact", "default", "comfortable"];
const LEGACY_ACCENT_COLOR_ALIASES = {
  indigo: "default",
  purple: "orchid",
  green: "forest",
  orange: "ember",
  pink: "rose",
  teal: "lagoon",
} as const satisfies Record<string, AccentColor>;

export const DEFAULT_APPEARANCE_SNAPSHOT: AppearanceSnapshot = {
  version: APPEARANCE_SNAPSHOT_VERSION,
  theme: "system",
  accentColor: "default",
  density: "default",
  reduceMotion: false,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && ACCENT_COLORS.includes(value as AccentColor);
}

export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && DENSITIES.includes(value as Density);
}

function normalizeUpdatedAt(value: unknown, fallbackIso: string): string {
  if (typeof value !== "string") return fallbackIso;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallbackIso;
  return parsed.toISOString();
}

export function normalizeThemeMode(value: unknown, fallback: ThemeMode = DEFAULT_APPEARANCE_SNAPSHOT.theme): ThemeMode {
  return isThemeMode(value) ? value : fallback;
}

export function normalizeAccentColor(
  value: unknown,
  fallback: AccentColor = DEFAULT_APPEARANCE_SNAPSHOT.accentColor,
): AccentColor {
  if (typeof value === "string" && value in LEGACY_ACCENT_COLOR_ALIASES) {
    return LEGACY_ACCENT_COLOR_ALIASES[value as keyof typeof LEGACY_ACCENT_COLOR_ALIASES];
  }
  return isAccentColor(value) ? value : fallback;
}

export function normalizeDensity(value: unknown, fallback: Density = DEFAULT_APPEARANCE_SNAPSHOT.density): Density {
  return isDensity(value) ? value : fallback;
}

export function parseAppearanceSnapshot(value: unknown): AppearanceSnapshot | null {
  if (!isRecord(value)) return null;

  const nowIso = new Date().toISOString();
  const theme = normalizeThemeMode(value.theme);
  const accentColor = normalizeAccentColor(value.accentColor);
  const density = normalizeDensity(value.density);
  if (typeof value.reduceMotion !== "boolean") return null;

  return {
    version: APPEARANCE_SNAPSHOT_VERSION,
    theme,
    accentColor,
    density,
    reduceMotion: value.reduceMotion,
    updatedAt: normalizeUpdatedAt(value.updatedAt, nowIso),
  };
}

export function parseAppearanceSnapshotFromJson(raw: string | null | undefined): AppearanceSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseAppearanceSnapshot(parsed);
  } catch {
    return null;
  }
}

export function createAppearanceSnapshot(
  input: Partial<AppearanceSnapshot>,
  nowIso: string = new Date().toISOString(),
): AppearanceSnapshot {
  return {
    version: APPEARANCE_SNAPSHOT_VERSION,
    theme: normalizeThemeMode(input.theme),
    accentColor: normalizeAccentColor(input.accentColor),
    density: normalizeDensity(input.density),
    reduceMotion: typeof input.reduceMotion === "boolean" ? input.reduceMotion : DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion,
    updatedAt: normalizeUpdatedAt(input.updatedAt, nowIso),
  };
}

function toMs(snapshot: AppearanceSnapshot): number {
  return new Date(snapshot.updatedAt).getTime();
}

export function isSnapshotNewer(candidate: AppearanceSnapshot, baseline: AppearanceSnapshot): boolean {
  return toMs(candidate) > toMs(baseline);
}

export function choosePreferredSnapshot(local: AppearanceSnapshot, remote: AppearanceSnapshot | null): AppearanceSnapshot {
  if (!remote) return local;
  return isSnapshotNewer(remote, local) ? remote : local;
}

export function areAppearanceSnapshotsEquivalent(
  left: AppearanceSnapshot | null | undefined,
  right: AppearanceSnapshot | null | undefined,
): boolean {
  if (!left || !right) return false;
  return (
    left.theme === right.theme &&
    left.accentColor === right.accentColor &&
    left.density === right.density &&
    left.reduceMotion === right.reduceMotion
  );
}

export function resolveThemeMode(theme: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

export function readLocalAppearanceSnapshot(
  readStorage: (key: string) => string | null,
  nowIso: string = new Date().toISOString(),
): AppearanceSnapshot {
  const fromSnapshot = parseAppearanceSnapshotFromJson(readStorage(APPEARANCE_STORAGE_KEYS.snapshot));
  if (fromSnapshot) return fromSnapshot;

  const legacyTheme = normalizeThemeMode(readStorage(APPEARANCE_STORAGE_KEYS.theme));
  const legacyAccent = normalizeAccentColor(readStorage(APPEARANCE_STORAGE_KEYS.accent));
  const legacyDensity = normalizeDensity(readStorage(APPEARANCE_STORAGE_KEYS.density));

  return createAppearanceSnapshot(
    {
      theme: legacyTheme,
      accentColor: legacyAccent,
      density: legacyDensity,
      reduceMotion: readStorage(APPEARANCE_STORAGE_KEYS.reduceMotion) === "true",
      updatedAt: nowIso,
    },
    nowIso,
  );
}

export function serializeAppearanceSnapshot(snapshot: AppearanceSnapshot): string {
  return JSON.stringify(snapshot);
}

export function writeAppearanceSnapshot(
  snapshot: AppearanceSnapshot,
  writeStorage: (key: string, value: string) => void,
): void {
  writeStorage(APPEARANCE_STORAGE_KEYS.snapshot, serializeAppearanceSnapshot(snapshot));
  writeStorage(APPEARANCE_STORAGE_KEYS.theme, snapshot.theme);
  writeStorage(APPEARANCE_STORAGE_KEYS.accent, snapshot.accentColor);
  writeStorage(APPEARANCE_STORAGE_KEYS.density, snapshot.density);
  writeStorage(APPEARANCE_STORAGE_KEYS.reduceMotion, String(snapshot.reduceMotion));
}

export function buildThemePrehydrateScript(): string {
  const keys = APPEARANCE_STORAGE_KEYS;
  const defaults = DEFAULT_APPEARANCE_SNAPSHOT;

  return `(() => {
  try {
    const root = document.documentElement;
    const THEME_VALUES = new Set(["light", "dark", "system"]);
    const ACCENT_VALUES = new Set(["default", "orchid", "forest", "ember", "rose", "lagoon"]);
    const LEGACY_ACCENT_ALIASES = {
      indigo: "default",
      purple: "orchid",
      green: "forest",
      orange: "ember",
      pink: "rose",
      teal: "lagoon",
    };
    const DENSITY_VALUES = new Set(["compact", "default", "comfortable"]);
    const normalizeAccent = (value, fallback) => {
      if (typeof value !== "string") return fallback;
      if (ACCENT_VALUES.has(value)) return value;
      return LEGACY_ACCENT_ALIASES[value] || fallback;
    };
    const parseSnapshot = (raw) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        if (!THEME_VALUES.has(parsed.theme)) return null;
        parsed.accentColor = normalizeAccent(parsed.accentColor, "${defaults.accentColor}");
        if (!DENSITY_VALUES.has(parsed.density)) return null;
        if (typeof parsed.reduceMotion !== "boolean") return null;
        return parsed;
      } catch {
        return null;
      }
    };

    const snapshot = parseSnapshot(localStorage.getItem("${keys.snapshot}"));
    const theme = THEME_VALUES.has(localStorage.getItem("${keys.theme}"))
      ? localStorage.getItem("${keys.theme}")
      : (snapshot?.theme || "${defaults.theme}");
    const accent = normalizeAccent(snapshot?.accentColor, normalizeAccent(localStorage.getItem("${keys.accent}"), "${defaults.accentColor}"));
    const density = DENSITY_VALUES.has(snapshot?.density)
      ? snapshot.density
      : (DENSITY_VALUES.has(localStorage.getItem("${keys.density}")) ? localStorage.getItem("${keys.density}") : "${defaults.density}");
    const prefersReducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const reduceMotion = typeof snapshot?.reduceMotion === "boolean"
      ? snapshot.reduceMotion
      : localStorage.getItem("${keys.reduceMotion}") === "true";

    const systemPrefersDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const resolvedTheme = theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
    const isDark = resolvedTheme === "dark";

    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
    root.setAttribute("data-theme-mode", theme);
    root.setAttribute("data-accent", accent || "${defaults.accentColor}");
    root.setAttribute("data-density", density || "${defaults.density}");
    if (reduceMotion || prefersReducedMotion) root.setAttribute("data-reduce-motion", "true");
    else root.removeAttribute("data-reduce-motion");

    const desired = isDark ? "#0a0a0a" : "#ffffff";
    let meta = document.querySelector('meta[data-app-theme-color="true"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.setAttribute("data-app-theme-color", "true");
      document.head.appendChild(meta);
    }
    if (meta.content !== desired) meta.content = desired;
  } catch (_) {
    // no-op
  }
})();`;
}
