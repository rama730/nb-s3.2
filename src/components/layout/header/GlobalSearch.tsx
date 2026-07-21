"use client";

import { Search, X } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import {
    buildGlobalSearchClearHref,
    getGlobalSearchQuery,
    resolveGlobalSearchContext,
    type GlobalSearchContext,
} from "./global-search";

interface GlobalSearchProps {
    onOpenCommandPalette: (initialQuery?: string, context?: GlobalSearchContext) => void;
    condensed?: boolean;
}

export default function GlobalSearch({ onOpenCommandPalette, condensed = false }: GlobalSearchProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const paramsString = searchParams?.toString() ?? "";
    const { context, placeholder } = useMemo(
        () => resolveGlobalSearchContext(pathname, new URLSearchParams(paramsString)),
        [paramsString, pathname],
    );
    const query = useMemo(
        () => getGlobalSearchQuery(new URLSearchParams(searchParams?.toString()), context),
        [context, searchParams],
    );

    const isMac = useMemo(() => {
        if (typeof navigator === "undefined") return false;
        return navigator.platform.toUpperCase().includes("MAC");
    }, []);

    const triggerLabel = useMemo(() => {
        const contextLabel = (() => {
            switch (context) {
                case "hub":
                    return "Search projects";
                case "people":
                    return placeholder.replace(/\.\.\.$/, "");
                case "messages":
                    return "Open the dedicated Messages search";
                case "project":
                    return "Search this project";
                case "settings":
                    return "Search settings";
                default:
                    return "Search projects";
            }
        })();

        if (!query.trim()) {
            return contextLabel;
        }

        return `${contextLabel}. Current query: ${query.trim()}`;
    }, [context, placeholder, query]);

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        const href = buildGlobalSearchClearHref({
            pathname: pathname || "/",
            searchParams: new URLSearchParams(searchParams?.toString()),
            context,
        });
        router.push(href);
    };

    return (
        <div
            className={`
                hidden md:flex items-center rounded-xl
                border bg-white/80 dark:bg-zinc-950/80
                transition-colors duration-150 group relative overflow-hidden shadow-sm
                ${condensed
                    ? 'h-10 w-10 shrink-0 justify-center gap-0 border-transparent bg-transparent px-0 py-0 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                    : `h-10 w-60 gap-2 px-3 ${query
                        ? 'border-primary/30 ring-1 ring-primary/10'
                        : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                    }`
                }
            `}
        >
            <button
                type="button"
                onClick={() => onOpenCommandPalette(query, context)}
                aria-label={triggerLabel}
                className={`flex min-w-0 items-center rounded-lg transition-colors duration-150 focus:outline-none ${
                    condensed ? 'justify-center' : 'flex-1 gap-2'
                }`}
            >
                <Search className={`w-4 h-4 shrink-0 transition-colors duration-300
                    ${condensed
                        ? 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                        : (query ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 group-hover:text-zinc-500")
                    }`}
                />

                <div className={`items-center flex-1 overflow-hidden ${condensed ? 'hidden' : 'flex w-auto opacity-100'}`}>
                    <span className={`text-sm whitespace-nowrap truncate transition-colors ${query ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-400"}`}>
                        {query || placeholder}
                    </span>
                </div>
            </button>

            <div className={`items-center shrink-0 ${condensed ? 'hidden' : 'flex w-auto opacity-100 ml-auto'}`}>
                {query ? (
                    <button
                        type="button"
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
