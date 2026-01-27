'use client';

import { useState, useEffect } from 'react';
import { useTheme, useAppearance } from '@/components/providers/theme-provider';
import { Moon, Sun, Monitor, Type, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";

interface AppearanceSettingsProps {
    user?: any;
    onUserUpdate?: (user: any) => void;
}

export default function AppearanceSettings(_: AppearanceSettingsProps) {
    const { theme, setTheme } = useTheme();
    const {
        accentColor, setAccentColor,
        density, setDensity,
        reduceMotion, setReduceMotion
    } = useAppearance();

    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return null;
    }

    return (
        <div className="space-y-10 pb-10">
            <SettingsPageHeader
                title="Appearance"
                description="Customize theme, accent color, density, and motion."
            />

            {/* Mode (Light/Dark) */}
            <section className="space-y-4">
                <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Theme Mode</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {(['light', 'dark', 'system'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setTheme(mode)}
                            className={`
                                relative p-4 rounded-xl border-2 text-left transition-all duration-200
                                ${theme === mode
                                    ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-500/10'
                                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900'}
                            `}
                        >
                            <div className={`p-2 rounded-lg w-fit mb-3 ${theme === mode ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>
                                {mode === 'light' && <Sun size={20} />}
                                {mode === 'dark' && <Moon size={20} />}
                                {mode === 'system' && <Monitor size={20} />}
                            </div>
                            <div className="font-semibold text-zinc-900 dark:text-zinc-50 capitalize">{mode}</div>
                            <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                {mode === 'light' ? 'Light appearance' : mode === 'dark' ? 'Dark appearance' : 'Syncs with device'}
                            </div>
                            {theme === mode && (
                                <motion.div
                                    layoutId="mode-check"
                                    className="absolute top-4 right-4 w-4 h-4 rounded-full bg-indigo-600 border-2 border-white dark:border-zinc-950"
                                />
                            )}
                        </button>
                    ))}
                </div>
            </section>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Accent Color */}
            <section className="space-y-4">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500" />
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Accent Color</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                    {[
                        { id: 'indigo', color: 'bg-indigo-600' },
                        { id: 'purple', color: 'bg-purple-600' },
                        { id: 'green', color: 'bg-green-600' },
                        { id: 'orange', color: 'bg-orange-600' },
                        { id: 'pink', color: 'bg-pink-600' },
                        { id: 'teal', color: 'bg-teal-600' },
                    ].map((accent) => (
                        <button
                            key={accent.id}
                            onClick={() => setAccentColor(accent.id as any)}
                            className={`
                                w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200
                                ${accentColor === accent.id
                                    ? 'ring-4 ring-offset-2 ring-zinc-200 dark:ring-zinc-800 scale-110'
                                    : 'hover:scale-105 active:scale-95'}
                            `}
                        >
                            <span className={`w-full h-full rounded-full ${accent.color}`} />
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
            </section>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Interface Density */}
            <section className="space-y-4">
                <div className="flex items-center gap-2">
                    <Type size={20} className="text-zinc-500" />
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Interface Density</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        { id: 'compact', label: 'Compact', desc: 'More content at once' },
                        { id: 'default', label: 'Default', desc: 'Balanced spacing' },
                        { id: 'comfortable', label: 'Comfortable', desc: 'Relaxed layout' },
                    ].map((d) => (
                        <button
                            key={d.id}
                            onClick={() => setDensity(d.id as any)}
                            className={`
                                p-3 rounded-lg border text-left transition-all duration-200
                                ${density === d.id
                                    ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-500/10'
                                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}
                            `}
                        >
                            <div className="font-medium text-zinc-900 dark:text-zinc-50">{d.label}</div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">{d.desc}</div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Motion */}
            <section className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <Zap size={18} className="text-zinc-500" />
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">Reduce Motion</span>
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Minimize animations and transitions throughout the app.
                    </p>
                </div>
                <button
                    onClick={() => setReduceMotion(!reduceMotion)}
                    className={`
                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                        ${reduceMotion ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700'}
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

        </div>
    );
}
