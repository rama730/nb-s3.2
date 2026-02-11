"use client";

import { Search, X } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

interface GlobalSearchProps {
    onOpenCommandPalette: (initialQuery?: string, context?: string) => void;
    condensed?: boolean;
}

export default function GlobalSearch({ onOpenCommandPalette, condensed = false }: GlobalSearchProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const query = useMemo(() => {
        // Keep the pill text in sync with URL, per-page context.
        // - Hub/Explorer/People use `q` (or `tag`)
        // - Project uses `search` (Tasks tab filter)
        const isProject = (pathname || "").includes("/projects/");
        if (isProject) {
            return (searchParams?.get("search") || "").trim();
        }

        const q = searchParams?.get("q");
        const tag = searchParams?.get("tag");
        return (q || (tag ? `#${tag}` : "")).trim();
    }, [searchParams, pathname]);

    const isMac = useMemo(() => {
        if (typeof navigator === "undefined") return false;
        return navigator.platform.toUpperCase().includes("MAC");
    }, []);

    const { context, placeholder } = useMemo(() => {
        if (!pathname) {
            return { context: "default", placeholder: "Search..." };
        }

        if (pathname.includes("/explorer")) {
            return { context: "explorer", placeholder: "Search for inspiration..." };
        }
        if (pathname.includes("/people")) {
            return { context: "people", placeholder: "Find builders & collaborators..." };
        }
        if (pathname.includes("/hub")) {
            return { context: "hub", placeholder: "Search projects..." };
        }
        if (pathname.includes("/projects/")) {
            return { context: "project", placeholder: "Search this project or type 'New Task'..." };
        }
        if (pathname.includes("/messages")) {
            return { context: "messages", placeholder: "Search messages..." };
        }
        return { context: "default", placeholder: "Search..." };
    }, [pathname]);

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        const targetPath = pathname || "/";

        // For project pages, clear the Tasks search param only.
        if (context === "project") {
            const params = new URLSearchParams(searchParams?.toString());
            params.delete("search");
            params.set("page", "1");
            const qs = params.toString();
            router.push(qs ? `${targetPath}?${qs}` : targetPath);
            return;
        }

        router.push(targetPath);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && query.trim()) {
            e.preventDefault();
            e.stopPropagation();
            if (context === "hub") {
                // For hub context, directly update URL - Hub Priority Search
                router.push(`/hub?q=${encodeURIComponent(query.trim())}`);
                // Don't open command palette for Hub search
            } else if (context === "explorer") {
                // For explorer context, update URL with search query
                router.push(`/explorer?q=${encodeURIComponent(query.trim())}`);
                onOpenCommandPalette(query, context);
            } else if (context === "people") {
                // For people context, update URL with search query
                router.push(`/people?q=${encodeURIComponent(query.trim())}`);
                onOpenCommandPalette(query, context);
            } else if (context === "messages") {
                // For messages context, open command palette with message search
                onOpenCommandPalette(query, context);
            } else if (context === "project") {
                // For project pages, apply the query to the Tasks tab and open the palette.
                const targetPath = pathname || "/";
                const params = new URLSearchParams(searchParams?.toString());
                params.set("tab", "tasks");
                params.set("search", query.trim());
                params.set("page", "1");
                // Avoid reopening an unrelated task panel when starting a new search
                params.delete("task");
                params.delete("taskId");
                const qs = params.toString();
                router.push(`${targetPath}?${qs}`);
                onOpenCommandPalette(query, context);
            }
        }
    };

    return (
        <div
            onClick={() => onOpenCommandPalette(query, context)}
            onKeyDown={handleKeyDown}
            className={`
                hidden md:flex items-center rounded-full md:rounded-lg 
                border bg-zinc-50 dark:bg-zinc-900/50 
                transition-all duration-300 ease-in-out cursor-pointer group relative overflow-hidden
                ${condensed
                    ? 'w-9 h-9 border-transparent bg-transparent hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 justify-center px-0 py-0 shrink-0 gap-0'
                    : `px-3 py-1.5 gap-2 ${query
                        ? 'w-72 border-zinc-300 dark:border-zinc-700 shadow-sm'
                        : 'w-56 hover:w-64 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`
                }
            `}
        >
            <Search className={`w-4 h-4 shrink-0 transition-colors duration-300
                ${condensed
                    ? 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                    : (query ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 group-hover:text-zinc-500")
                }`}
            />

            <div className={`items-center flex-1 overflow-hidden transition-all duration-300 ease-in-out ${condensed ? 'hidden' : 'flex w-auto opacity-100'}`}>
                <span className={`text-sm whitespace-nowrap truncate transition-colors ${query ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-400"}`}>
                    {query || placeholder}
                </span>
            </div>

            <div className={`items-center shrink-0 transition-all duration-300 ease-in-out ${condensed ? 'hidden' : 'flex w-auto opacity-100 ml-auto'}`}>
                {query ? (
                    <button
                        onClick={handleClear}
                        className="p-0.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-300 transition-colors"
                        aria-label="Clear search"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                ) : (
                    <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono text-zinc-400 group-hover:text-zinc-500 transition-colors shadow-sm">
                        {isMac ? "⌘" : "Ctrl"}K
                    </kbd>
                )}
            </div>
        </div>
    );
}
