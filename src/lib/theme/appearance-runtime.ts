import type { AccentColor, Density } from "@/lib/theme/appearance";
import { isReducedMotionEnabled } from "@/lib/theme/reduced-motion";

export type AccentPaletteMeta = {
    id: AccentColor;
    label: string;
    description: string;
    solid: string;
    selectedTint: string;
    brandStart: string;
    brandEnd: string;
};

export const ACCENT_PALETTES: Record<AccentColor, AccentPaletteMeta> = {
    default: {
        id: "default",
        label: "Purple",
        description: "Solid purple actions with a light blue selected surface.",
        solid: "#5b3df5",
        selectedTint: "#dfe9ff",
        brandStart: "#2563eb",
        brandEnd: "#7c3aed",
    },
    orchid: {
        id: "orchid",
        label: "Orchid",
        description: "Solid violet actions with a soft lavender selected surface.",
        solid: "#7c3aed",
        selectedTint: "#efe4ff",
        brandStart: "#7c3aed",
        brandEnd: "#d946ef",
    },
    forest: {
        id: "forest",
        label: "Forest",
        description: "Solid emerald actions with a pale mint selected surface.",
        solid: "#10b981",
        selectedTint: "#def8ee",
        brandStart: "#10b981",
        brandEnd: "#0d9488",
    },
    ember: {
        id: "ember",
        label: "Ember",
        description: "Solid orange actions with a soft amber selected surface.",
        solid: "#f97316",
        selectedTint: "#fff0d9",
        brandStart: "#f59e0b",
        brandEnd: "#f97316",
    },
    rose: {
        id: "rose",
        label: "Rose",
        description: "Solid rose actions with a soft blush selected surface.",
        solid: "#e11d48",
        selectedTint: "#ffe1ea",
        brandStart: "#f43f5e",
        brandEnd: "#c026d3",
    },
    lagoon: {
        id: "lagoon",
        label: "Lagoon",
        description: "Solid teal actions with a pale cyan selected surface.",
        solid: "#0f766e",
        selectedTint: "#ddf7f6",
        brandStart: "#0f766e",
        brandEnd: "#06b6d4",
    },
};

export const DENSITY_LABELS: Record<Density, { label: string; description: string }> = {
    compact: {
        label: "Compact",
        description: "Tighter spacing for dense navigation, lists, and panels.",
    },
    default: {
        label: "Default",
        description: "Balanced spacing across forms, panels, and navigation.",
    },
    comfortable: {
        label: "Comfortable",
        description: "More breathing room in lists, cards, and page sections.",
    },
};

export function getAccentSwatchBackground(accentColor: AccentColor): string {
    const palette = ACCENT_PALETTES[accentColor];
    return `radial-gradient(circle at 72% 28%, ${palette.selectedTint} 0%, ${palette.selectedTint} 24%, transparent 26%), ${palette.solid}`;
}

export function resolveReducedMotionPreference(args: {
    root?: Element | null;
    matchMedia?: typeof window.matchMedia | null;
}): boolean {
    return isReducedMotionEnabled(args);
}
