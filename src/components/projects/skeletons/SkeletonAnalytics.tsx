export function SkeletonAnalytics() {
    return (
        <div className="space-y-4">
            <section aria-hidden="true" className="rounded-2xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/80">
                <div className="animate-pulse space-y-3">
                    <div className="h-2.5 w-32 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-7 w-60 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-3 w-full max-w-xl rounded-full bg-zinc-200 dark:bg-zinc-800" />
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                    </div>
                </div>
            </section>
            <section aria-hidden="true" className="rounded-2xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/80">
                <div className="grid animate-pulse gap-2 lg:grid-cols-3">
                    <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                </div>
            </section>
            <span className="sr-only" role="status" aria-live="polite">Loading project intelligence...</span>
        </div>
    );
}
