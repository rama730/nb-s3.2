export function SkeletonFiles() {
    return (
        <div className="space-y-6">
            <div className="flex gap-4">
                <div className="h-10 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
                <div className="h-10 w-32 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                    <div key={i} className="aspect-square bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-4 flex flex-col items-center justify-center gap-3 border border-zinc-200 dark:border-zinc-800">
                        <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
                        <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                    </div>
                ))}
            </div>
        </div>
    );
}
