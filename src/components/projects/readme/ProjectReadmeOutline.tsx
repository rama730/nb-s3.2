"use client";

import type { ProjectReadmeHeading } from "@/lib/projects/readme";
import { cn } from "@/lib/utils";

export function ProjectReadmeOutline({ headings }: { headings: ProjectReadmeHeading[] }) {
    if (!headings.length) {
        return (
            <div className="border-l border-zinc-200 pl-4 text-sm text-zinc-500 dark:border-zinc-800">
                No headings yet. Add sections to make the README easier to scan.
            </div>
        );
    }

    return (
        <nav className="border-l border-zinc-200 pl-4 dark:border-zinc-800" aria-label="README outline">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">On This README</p>
            <div className="space-y-1">
                {headings.map((heading) => (
                    <a
                        key={`${heading.id}-${heading.text}`}
                        href={`#${heading.id}`}
                        className={cn(
                            "block rounded-xl px-2 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                            heading.level > 1 && "ml-3",
                            heading.level > 2 && "ml-6 text-xs",
                        )}
                    >
                        {heading.text}
                    </a>
                ))}
            </div>
        </nav>
    );
}
