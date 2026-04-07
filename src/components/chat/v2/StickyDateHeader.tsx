'use client';

interface StickyDateHeaderProps {
    label: string;
    visible: boolean;
}

export function StickyDateHeader({ label, visible }: StickyDateHeaderProps) {
    if (!visible) return null;
    return (
        <div className="pointer-events-none absolute left-0 right-0 top-2 z-10 flex justify-center">
            <span className="rounded-full bg-white/95 px-3 py-1 text-xs text-zinc-500 shadow-sm ring-1 ring-zinc-100 backdrop-blur-sm dark:bg-zinc-900/95 dark:ring-zinc-800">
                {label}
            </span>
        </div>
    );
}
