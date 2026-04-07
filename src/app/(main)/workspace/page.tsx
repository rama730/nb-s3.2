export async function generateMetadata() {
    return {
        title: 'Workspace | Edge',
        description: 'Workspace redesign in progress.',
    };
}

export default function WorkspacePage() {
    return (
        <div
            className="flex h-full min-h-0 items-center justify-center overflow-auto bg-zinc-50 px-6 py-10 dark:bg-zinc-950"
            data-scroll-root="route"
        >
            <div className="w-full max-w-3xl rounded-3xl border border-zinc-200 bg-white/90 p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90">
                <div className="mb-4 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                    Workspace Reset In Progress
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                    The previous workspace has been removed.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                    This route is being rebuilt as a new panel-based workspace. The old dashboard, tabs,
                    widgets, notes, and inbox surface have been fully retired so the next version can be
                    designed on a clean foundation.
                </p>
            </div>
        </div>
    );
}
