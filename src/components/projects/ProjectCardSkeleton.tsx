'use client';

export default function ProjectCardSkeleton() {
    return (
        <div className="h-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col animate-pulse">
            {/* Header */}
            <div className="p-4 flex items-center justify-between">
                <div className="h-6 w-20 bg-zinc-200 dark:bg-zinc-700/50 rounded-lg" />
                <div className="h-6 w-24 bg-zinc-200 dark:bg-zinc-700/50 rounded-lg" />
            </div>

            {/* Main Content */}
            <div className="px-4 pb-4 flex-1">
                {/* Title */}
                <div className="h-6 w-3/4 bg-zinc-200 dark:bg-zinc-700/50 rounded mb-3" />

                {/* Description (2 lines) */}
                <div className="space-y-2 mb-4">
                    <div className="h-4 w-full bg-zinc-200 dark:bg-zinc-700/50 rounded" />
                    <div className="h-4 w-5/6 bg-zinc-200 dark:bg-zinc-700/50 rounded" />
                </div>

                {/* Tech stack */}
                <div className="flex gap-1.5 mb-2">
                    <div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-700/50 rounded-md" />
                    <div className="h-6 w-14 bg-zinc-200 dark:bg-zinc-700/50 rounded-md" />
                    <div className="h-6 w-12 bg-zinc-200 dark:bg-zinc-700/50 rounded-md" />
                </div>
            </div>

            {/* Footer */}
            <div className="mt-auto px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-3">
                {/* Upper row: Metrics & Actions skeleton */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-4 w-10 bg-zinc-200 dark:bg-zinc-700/50 rounded" />
                        <div className="h-4 w-10 bg-zinc-200 dark:bg-zinc-700/50 rounded" />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="h-7 w-7 bg-zinc-200 dark:bg-zinc-700/50 rounded-md" />
                        <div className="h-7 w-7 bg-zinc-200 dark:bg-zinc-700/50 rounded-md" />
                        <div className="h-7 w-7 bg-zinc-200 dark:bg-zinc-700/50 rounded-md" />
                    </div>
                </div>

                {/* Lower row: Avatars skeleton */}
                <div className="flex -space-x-1.5">
                    <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700/50 border-2 border-white dark:border-zinc-900" />
                    <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700/50 border-2 border-white dark:border-zinc-900" />
                    <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700/50 border-2 border-white dark:border-zinc-900" />
                </div>
            </div>
        </div>
    );
}
