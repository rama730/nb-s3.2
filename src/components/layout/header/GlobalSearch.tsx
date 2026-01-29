"use client";

import { Search, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

interface GlobalSearchProps {
    onOpenCommandPalette: (initialQuery?: string, context?: string) => void;
    condensed?: boolean;
}

export default function GlobalSearch({ onOpenCommandPalette, condensed = false }: GlobalSearchProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const [query, setQuery] = useState("");
    const [isMac, setIsMac] = useState(false);
    const [placeholder, setPlaceholder] = useState("Search...");
    const [context, setContext] = useState<"explorer" | "people" | "hub" | "project" | "messages" | "default">("default");

    useEffect(() => {
        // Keep the pill text in sync with URL, per-page context.
        // - Hub/Explorer/People use `q` (or `tag`)
        // - Project uses `search` (Tasks tab filter)
        const isProject = (pathname || "").includes("/projects/");
        if (isProject) {
            setQuery((searchParams?.get("search") || "").trim());
            return;
        }

        const q = searchParams?.get("q");
        const tag = searchParams?.get("tag");
        setQuery((q || (tag ? `#${tag}` : "")).trim());
    }, [searchParams, pathname]);

    useEffect(() => {
        setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
    }, []);

    // Determine context and placeholder based on pathname
    useEffect(() => {
        if (!pathname) return;

        if (pathname.includes("/explorer")) {
            setContext("explorer");
            setPlaceholder("Search for inspiration...");
        } else if (pathname.includes("/people")) {
            setContext("people");
            setPlaceholder("Find builders & collaborators...");
        } else if (pathname.includes("/hub")) {
            setContext("hub");
            setPlaceholder("Search projects...");
        } else if (pathname.includes("/projects/")) {
            setContext("project");
            setPlaceholder("Search this project or type 'New Task'...");
        } else if (pathname.includes("/messages")) {
            setContext("messages");
            setPlaceholder("Search messages...");
        } else {
            setContext("default");
            setPlaceholder("Search...");
        }
    }, [pathname]);

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        setQuery(""); // Optimistic update
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
