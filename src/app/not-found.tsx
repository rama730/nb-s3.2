import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-zinc-950">
      <div className="flex flex-col gap-2">
        <h1 className="text-9xl font-black tracking-tight text-zinc-200 dark:text-zinc-800">404</h1>
        <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">Page not found</p>
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Sorry, we couldn’t find the page you’re looking for.</p>
      </div>
      <Link
        href="/hub"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
      >
        Go back to Hub
      </Link>
    </div>
  );
}
