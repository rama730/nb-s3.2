export function SkeletonTasks() {
    return (
        <div className="flex gap-4 overflow-x-auto pb-4 h-[calc(100vh-200px)]">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="min-w-[300px] bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-4 flex flex-col gap-4 border border-zinc-200 dark:border-zinc-800">
                    <div className="h-6 w-1/2 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                    <div className="space-y-3">
                        <div className="h-32 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                            <div className="h-4 w-3/4 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                            <div className="h-3 w-1/2 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                        </div>
                        <div className="h-32 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                            <div className="h-4 w-3/4 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
