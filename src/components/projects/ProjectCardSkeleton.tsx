'use client';

export default function ProjectCardSkeleton() {
    return (
        <div className="h-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden animate-pulse">
            <div className="p-5">
                {/* Status badge skeleton */}
                <div className="flex items-center gap-2 mb-4">
                    <div className="h-6 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
                    <div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
                </div>

                {/* Title skeleton */}
                <div className="h-6 w-3/4 bg-zinc-200 dark:bg-zinc-700 rounded mb-3" />

                {/* Description skeleton */}
                <div className="space-y-2 mb-6">
                    <div className="h-4 w-full bg-zinc-200 dark:bg-zinc-700 rounded" />
                    <div className="h-4 w-5/6 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    <div className="h-4 w-2/3 bg-zinc-200 dark:bg-zinc-700 rounded" />
                </div>

                {/* Tech stack skeleton */}
                <div className="flex gap-2 mb-6">
                    <div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                    <div className="h-6 w-14 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                    <div className="h-6 w-12 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                </div>
            </div>

            {/* Footer skeleton */}
            <div className="px-5 pb-5 flex items-center justify-between">
                <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-white dark:border-zinc-900" />
                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-white dark:border-zinc-900" />
                </div>
                <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
        </div>
    );
}
