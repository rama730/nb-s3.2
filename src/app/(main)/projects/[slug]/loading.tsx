export default function ProjectDetailLoading() {
  return (
    <div
      className="h-full min-h-0 bg-zinc-50 p-6 dark:bg-zinc-950"
      role="status"
      aria-label="Loading project"
    >
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        <div className="h-8 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-10 w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="h-72 rounded-xl bg-zinc-100 dark:bg-zinc-900 lg:col-span-7" />
          <div className="h-72 rounded-xl bg-zinc-100 dark:bg-zinc-900 lg:col-span-5" />
        </div>
      </div>
    </div>
  );
}
