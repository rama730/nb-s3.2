export function SkeletonSprints() {
    return (
        <div className="space-y-6">
            <div className="h-48 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-6 border border-zinc-200 dark:border-zinc-800 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-zinc-200 dark:via-zinc-700 to-transparent animate-shimmer" />
                <div className="space-y-4">
                    <div className="h-8 w-1/4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                    <div className="h-4 w-1/2 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                    <div className="flex gap-2 mt-8">
                        <div className="h-10 w-10 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                        <div className="h-10 w-10 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                        <div className="h-10 w-10 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                    </div>
                </div>
            </div>
            <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg border border-zinc-200 dark:border-zinc-800" />
                ))}
            </div>
        </div>
    );
}
