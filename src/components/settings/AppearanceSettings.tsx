'use client';

import { useState, useEffect } from 'react';
import { useTheme, useAppearance } from '@/components/providers/theme-provider';
import { Moon, Sun, Monitor, Type, Zap, RotateCcw } from 'lucide-react';
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { ACCENT_PALETTES, DENSITY_LABELS, getAccentSwatchBackground } from '@/lib/theme/appearance-runtime';
import { DEFAULT_APPEARANCE_SNAPSHOT } from '@/lib/theme/appearance';

export default function AppearanceSettings() {
    const { theme, resolvedTheme, setThemeWithTransition } = useTheme();
    const {
        accentColor, setAccentColor,
        density, setDensity,
        reduceMotion, setReduceMotion,
        syncState, lastSyncedAt, resetAppearance,
    } = useAppearance();

    const [mounted, setMounted] = useState(false);
    type AccentColorValue = Parameters<typeof setAccentColor>[0];
    type DensityValue = Parameters<typeof setDensity>[0];

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return null;
    }

    const isDefaultAppearance =
        theme === DEFAULT_APPEARANCE_SNAPSHOT.theme &&
        accentColor === DEFAULT_APPEARANCE_SNAPSHOT.accentColor &&
        density === DEFAULT_APPEARANCE_SNAPSHOT.density &&
        reduceMotion === DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion;

    const syncMessage =
        syncState === 'saving'
            ? 'Syncing to your account'
            : syncState === 'save_failed'
                ? 'Couldn’t sync account preference'
                : syncState === 'saved'
                    ? `Saved to your account${lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
                    : 'Saved on this device';

    return (
        <div className="space-y-10 pb-10">
            <SettingsPageHeader
                title="Appearance"
                description="Customize theme, accent color, density, and motion across the app."
                action={(
                    <button
                        type="button"
                        onClick={() => void resetAppearance()}
                        disabled={syncState === 'saving' || isDefaultAppearance}
                        className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                        <RotateCcw size={16} />
                        Reset to defaults
                    </button>
                )}
            />

            <p
                className={`text-sm ${
                    syncState === 'save_failed'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                }`}
            >
                {syncMessage}
            </p>

            {/* Mode (Light/Dark) */}
            <section className="space-y-4">
                <div className="space-y-1">
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Theme Mode</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Choose how the full interface renders on this device and in your account preference.
                    </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {(['light', 'dark', 'system'] as const).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            data-testid={`appearance-theme-${mode}`}
                            onClick={() => void setThemeWithTransition(mode)}
                            className={`
                                relative p-4 rounded-xl border-2 text-left transition-all duration-200
                                ${theme === mode
                                    ? 'border-primary bg-primary/10'
                                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900'}
                            `}
                        >
                            <div className={`p-2 rounded-lg w-fit mb-3 ${theme === mode ? 'bg-primary text-primary-foreground' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>
                                {mode === 'light' && <Sun size={20} />}
                                {mode === 'dark' && <Moon size={20} />}
                                {mode === 'system' && <Monitor size={20} />}
                            </div>
                            <div className="font-semibold text-zinc-900 dark:text-zinc-50 capitalize">{mode}</div>
                            <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                {mode === 'light' ? 'Light appearance' : mode === 'dark' ? 'Dark appearance' : 'Syncs with device'}
                            </div>
                            {theme === mode && (
                                <div className="absolute top-4 right-4 w-4 h-4 rounded-full bg-primary border-2 border-white dark:border-zinc-950" />
                            )}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Effective theme right now: <span className="font-medium capitalize">{resolvedTheme}</span>
                </p>
            </section>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Accent Color */}
            <section className="space-y-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <div
                            className="w-5 h-5 rounded-full border border-white/50 dark:border-zinc-900/30"
                            style={{ background: getAccentSwatchBackground(accentColor) }}
                        />
                        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Accent Color</h3>
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Accent color defines the solid action color and the softer selected surface used across the app.
                    </p>
                </div>
                <div className="flex flex-wrap gap-4 py-3 pl-3 pr-2">
                    {Object.values(ACCENT_PALETTES).map((accent) => (
                        <button
                            key={accent.id}
                            type="button"
                            onClick={() => setAccentColor(accent.id as AccentColorValue)}
                            title={accent.label}
                            data-testid={`appearance-accent-${accent.id}`}
                            className={`
                                relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200
                                ${accentColor === accent.id
                                    ? 'ring-4 ring-offset-2 ring-zinc-200 dark:ring-zinc-800 scale-110'
                                    : 'hover:scale-105 active:scale-95'}
                            `}
                        >
                            <span
                                className="w-full h-full rounded-full border border-white/50 dark:border-zinc-900/30"
                                style={{ background: getAccentSwatchBackground(accent.id) }}
                            />
                            {accentColor === accent.id && (
                                <span className="absolute inset-0 flex items-center justify-center text-white">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2.5 py-1">
                        Solid fill = actions and strong selected emphasis
                    </span>
                    <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2.5 py-1">
                        Light tint = softer selected surfaces
                    </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Selected palette: <span className="font-medium text-zinc-700 dark:text-zinc-200">{ACCENT_PALETTES[accentColor].label}</span>
                    {accentColor === DEFAULT_APPEARANCE_SNAPSHOT.accentColor ? (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            Default
                        </span>
                    ) : null}
                    . {ACCENT_PALETTES[accentColor].description}
                </p>
            </section>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Interface Density */}
            <section className="space-y-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Type size={20} className="text-zinc-500" />
                        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Interface Density</h3>
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Density controls spacing in navigation, lists, panels, cards, and forms across the app.
                    </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {Object.entries(DENSITY_LABELS).map(([densityId, densityMeta]) => (
                        <button
                            key={densityId}
                            type="button"
                            onClick={() => setDensity(densityId as DensityValue)}
                            data-testid={`appearance-density-${densityId}`}
                            className={`
                                p-3 rounded-lg border text-left transition-all duration-200
                                ${density === densityId
                                    ? 'border-primary bg-primary/10'
                                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}
                            `}
                        >
                            <div className="font-medium text-zinc-900 dark:text-zinc-50">{densityMeta.label}</div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">{densityMeta.description}</div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Motion */}
            <section className="flex items-center justify-between gap-6 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Zap size={18} className="text-zinc-500" />
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">Reduce Motion</span>
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Minimize animations, transitions, hover motion, and smooth scrolling for a steadier interface.
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        This also respects your device accessibility preference.
                    </p>
                </div>
                <button
                        type="button"
                        onClick={() => setReduceMotion(!reduceMotion)}
                        data-testid="appearance-reduce-motion-toggle"
                        className={`
                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                        ${reduceMotion ? 'bg-primary' : 'bg-zinc-200 dark:bg-zinc-700'}
                    `}
                >
                    <span
                        className={`
                            inline-block h-4 w-4 transform rounded-full bg-white dark:bg-zinc-900 transition-transform
                            ${reduceMotion ? 'translate-x-6' : 'translate-x-1'}
                        `}
                    />
                </button>
            </section>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Appearance changes apply locally first and then sync to your account in the background.
            </p>
        </div>
    );
}
