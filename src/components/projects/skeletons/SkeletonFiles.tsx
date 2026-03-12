export function SkeletonFiles() {
    return (
        <div className="flex-1 min-h-0 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
            <div className="flex h-full min-h-0">
                <aside className="hidden md:flex w-[290px] shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40">
                    <div className="h-11 shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-3 flex items-center gap-2">
                        <div className="h-7 w-7 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="ml-auto h-7 w-7 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                    </div>
                    <div className="h-10 shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-3 flex items-center gap-2">
                        <div className="h-6 w-6 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-6 w-6 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-6 w-6 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="ml-auto h-6 w-14 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                    </div>
                    <div className="flex-1 min-h-0 p-3 space-y-2 overflow-hidden">
                        {Array.from({ length: 14 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div
                                    className="h-3 w-3 rounded-sm bg-zinc-200 dark:bg-zinc-800 animate-pulse"
                                    style={{ marginLeft: `${(i % 4) * 12}px` }}
                                />
                                <div
                                    className="h-3 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse"
                                    style={{ width: `${40 + ((i * 13) % 45)}%` }}
                                />
                            </div>
                        ))}
                    </div>
                </aside>

                <section className="flex-1 min-w-0 min-h-0 flex flex-col">
                    <div className="h-11 shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-3 flex items-center gap-2">
                        <div className="h-7 w-28 rounded-md bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-7 w-24 rounded-md bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-7 w-20 rounded-md bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                    </div>

                    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-0">
                        <div className="p-4 md:p-5 overflow-hidden">
                            <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-4" />
                            <div className="space-y-3">
                                {Array.from({ length: 14 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="h-3 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse"
                                        style={{ width: `${92 - ((i * 7) % 38)}%` }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="hidden xl:block border-l border-zinc-200 dark:border-zinc-800 p-4">
                            <div className="h-7 w-32 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-4" />
                            <div className="space-y-3">
                                {Array.from({ length: 8 }).map((_, i) => (
                                    <div key={i} className="h-3 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="h-8 shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-3 flex items-center justify-between">
                        <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                    </div>
                </section>
            </div>
        </div>
    );
}
