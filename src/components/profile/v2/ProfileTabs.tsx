'use client';

import { cn } from '@/lib/utils';
import type { ProfileTabKey } from './types';

const TABS: Array<{ key: ProfileTabKey; label: string; hint: string }> = [
    { key: 'overview', label: 'Overview', hint: 'Bio, skills, experience' },
    { key: 'portfolio', label: 'Portfolio', hint: 'Projects & roles' },
];

export function ProfileTabs({
    value,
    onChange,
    className,
}: {
    value: ProfileTabKey;
    onChange: (next: ProfileTabKey) => void;
    className?: string;
}) {
    return (
        <div
            className={cn(
                // Sticky positioning: Use both var and fallback for safety. z-30 to be safe.
                'sticky z-30 -mx-4 sm:mx-0 px-4 sm:px-0 transition-all duration-200',
                className
            )}
            style={{ top: "12px" }}
        >
            <div className="transition-all duration-200 py-0">
                <div
                    className={cn(
                        'border border-zinc-200 dark:border-zinc-800 p-1 flex gap-1 shadow-sm overflow-hidden transition-all duration-300',
                        'bg-white/95 dark:bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 supports-[backdrop-filter]:dark:bg-zinc-950/80',
                        'rounded-2xl'
                    )}
                >
                    {TABS.map((t) => {
                        const active = t.key === value;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => onChange(t.key)}
                                className={cn(
                                    'flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 text-left group',
                                    active
                                        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm'
                                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:bg-transparent dark:hover:bg-zinc-900'
                                )}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold">{t.label}</span>
                                    {active ? (
                                        <span className="text-[11px] opacity-90 hidden sm:inline-block font-normal">
                                            {t.hint}
                                        </span>
                                    ) : null}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
