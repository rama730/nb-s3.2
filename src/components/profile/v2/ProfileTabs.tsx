'use client';

import { cn } from '@/lib/utils';
import type { ProfileTabKey } from './types';
import { useEffect, useRef, useState } from 'react';

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
    const containerRef = useRef<HTMLDivElement>(null);
    const [isStuck, setIsStuck] = useState(false);

    useEffect(() => {
        function getHeaderHeight() {
            if (typeof document === 'undefined') return 64;
            // Try to get from CSS var, fallback to 64px
            const raw = getComputedStyle(document.documentElement)
                .getPropertyValue('--header-height')
                .trim();
            const px = Number.parseFloat(raw.replace('px', ''));
            return Number.isFinite(px) && px > 0 ? px : 64;
        }

        function onScroll() {
            const el = containerRef.current;
            if (!el) return;
            const headerHeight = getHeaderHeight();
            const rect = el.getBoundingClientRect();
            // Check if element is at or above the stick point
            // We use a small buffer (+1) to avoid flickering
            setIsStuck(rect.top <= headerHeight + 1);
        }

        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className={cn(
                // Sticky positioning: Use both var and fallback for safety. z-30 to be safe.
                'sticky top-16 sm:top-[var(--header-height,64px)] z-30 -mx-4 sm:mx-0 px-4 sm:px-0 transition-all duration-200',
                className
            )}
        >
            <div className={cn('transition-all duration-200', isStuck ? 'py-0' : 'py-3')}>
                <div
                    className={cn(
                        'border border-zinc-200 dark:border-zinc-800 p-1 flex gap-1 shadow-sm overflow-hidden transition-all duration-300',
                        'bg-white/95 dark:bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 supports-[backdrop-filter]:dark:bg-zinc-950/80',
                        // Visual transformation when stuck: rounded bottom only, no top border
                        isStuck
                            ? 'rounded-b-2xl rounded-t-none border-t-0 shadow-md'
                            : 'rounded-2xl'
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
