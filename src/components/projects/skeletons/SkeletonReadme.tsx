export function SkeletonReadme() {
    return (
        <div className="mx-auto w-full max-w-[1480px] space-y-5 px-4 py-2 sm:px-6 lg:px-8" aria-hidden="true">
            <span className="sr-only" role="status" aria-live="polite">Loading README…</span>
            <div className="flex justify-end">
                <div className="h-9 w-20 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
            </div>
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="space-y-4">
                    <div className="h-8 w-1/2 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-4 w-full animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-4 w-5/6 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-4 w-3/4 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                </div>
                <div className="hidden h-64 animate-pulse border-l border-zinc-200 bg-zinc-100/60 pl-4 dark:border-zinc-800 dark:bg-zinc-900/60 xl:block" />
            </div>
        </div>
    );
}
