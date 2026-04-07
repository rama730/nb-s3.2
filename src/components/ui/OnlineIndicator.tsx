'use client';

interface OnlineIndicatorProps {
    online: boolean;
    size?: 'sm' | 'md';
}

export function OnlineIndicator({ online, size = 'sm' }: OnlineIndicatorProps) {
    if (!online) return null;
    const sizeClass = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';
    return (
        <span className={`absolute bottom-0 right-0 block ${sizeClass} rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950`} />
    );
}
