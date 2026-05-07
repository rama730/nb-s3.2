function PulseBlock({ className }: { className: string }) {
    return <div aria-hidden="true" className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

function SettingsRailSkeleton() {
    return (
        <aside aria-hidden="true" className="h-fit rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="px-3 py-3">
                <PulseBlock className="h-3 w-32" />
                <PulseBlock className="mt-3 h-6 w-40" />
                <PulseBlock className="mt-3 h-4 w-full" />
                <PulseBlock className="mt-2 h-4 w-4/5" />
            </div>
            <div className="mt-2 space-y-1">
                {Array.from({ length: 9 }).map((_, index) => (
                    <div
                        key={index}
                        className="flex items-start gap-3 rounded-2xl px-3 py-3"
                    >
                        <PulseBlock className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
                        <div className="min-w-0 flex-1">
                            <PulseBlock className="h-4 w-28" />
                            <PulseBlock className="mt-2 h-3 w-full" />
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
}

function SettingsCardSkeleton({ tall = false }: { tall?: boolean }) {
    return (
        <section aria-hidden="true" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start gap-4">
                <PulseBlock className="h-11 w-11 shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1">
                    <PulseBlock className="h-5 w-44" />
                    <PulseBlock className="mt-3 h-4 w-full max-w-2xl" />
                    <PulseBlock className="mt-2 h-4 w-3/5" />
                    {tall ? (
                        <div className="mt-5 space-y-3">
                            <PulseBlock className="h-44 w-full rounded-2xl" />
                            <div className="flex gap-2">
                                <PulseBlock className="h-10 w-32 rounded-xl" />
                                <PulseBlock className="h-10 w-20 rounded-xl" />
                            </div>
                        </div>
                    ) : (
                        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            <PulseBlock className="h-14 rounded-2xl" />
                            <PulseBlock className="h-14 rounded-2xl" />
                            <PulseBlock className="h-14 rounded-2xl" />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

export function SkeletonSettings() {
    return (
        <>
            <span className="sr-only" role="status" aria-live="polite">
                Loading settings…
            </span>
            <div aria-hidden="true" className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                <SettingsRailSkeleton />
                <div className="min-w-0 space-y-5">
                    <section aria-hidden="true" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                        <PulseBlock className="h-3 w-24" />
                        <PulseBlock className="mt-3 h-7 w-48" />
                        <PulseBlock className="mt-3 h-4 w-full max-w-3xl" />
                        <PulseBlock className="mt-2 h-4 w-2/3" />
                    </section>
                    <SettingsCardSkeleton />
                    <SettingsCardSkeleton tall />
                    <section aria-hidden="true" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                        <PulseBlock className="h-5 w-32" />
                        <PulseBlock className="mt-3 h-4 w-full max-w-xl" />
                        <div className="mt-5 grid gap-4">
                            <PulseBlock className="h-10 rounded-xl" />
                            <PulseBlock className="h-10 rounded-xl" />
                            <PulseBlock className="h-28 rounded-xl" />
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
