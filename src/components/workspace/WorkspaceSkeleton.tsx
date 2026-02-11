/**
 * WorkspaceSkeleton — loading skeleton that mirrors the default 6-column grid layout.
 * Matches the DEFAULT_LAYOUT structure so the visual transition to real content is seamless.
 */
export default function WorkspaceSkeleton() {
    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {/* Tab bar skeleton — 6 tabs */}
            <div className="flex gap-2 mb-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-9 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
                ))}
            </div>

            {/* Grid skeleton — matches the default layout's 6-column structure */}
            <div
                className="grid gap-3"
                style={{
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gridTemplateRows: 'repeat(3, 140px)',
                }}
            >
                {/* Quick Notes (2x2) */}
                <div
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse"
                    style={{ gridColumn: '1 / span 2', gridRow: '1 / span 2' }}
                />
                {/* Today's Focus (2x2) */}
                <div
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse"
                    style={{ gridColumn: '3 / span 2', gridRow: '1 / span 2' }}
                />
                {/* Urgent Items (2x1) */}
                <div
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse"
                    style={{ gridColumn: '5 / span 2', gridRow: '1 / span 1' }}
                />
                {/* My Projects (2x1) */}
                <div
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse"
                    style={{ gridColumn: '5 / span 2', gridRow: '2 / span 1' }}
                />
                {/* Recent Activity (3x1) */}
                <div
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse"
                    style={{ gridColumn: '1 / span 3', gridRow: '3 / span 1' }}
                />
                {/* Recent Messages (3x1) */}
                <div
                    className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse"
                    style={{ gridColumn: '4 / span 3', gridRow: '3 / span 1' }}
                />
            </div>

            {/* Mobile skeleton — shows as stacked cards on small screens */}
            <div className="lg:hidden space-y-3 mt-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-48 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse" />
                ))}
            </div>
        </div>
    );
}
