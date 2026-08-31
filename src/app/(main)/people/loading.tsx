export default function PeopleLoading() {
    return (
        <div className="space-y-5 px-4 py-6 sm:px-6" role="status" aria-label="Loading connections">
            <div className="mx-auto h-11 w-80 max-w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50" />)}
            </div>
        </div>
    );
}
