"use client";

interface MessageIndicatorProps {
    hasUnread: boolean;
    className?: string;
}

export default function MessageIndicator({ hasUnread, className = "" }: MessageIndicatorProps) {
    if (!hasUnread) return null;

    return (
        <div className={`relative ${className}`}>
            {/* Small red dot indicator */}
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-zinc-900" />
        </div>
    );
}
