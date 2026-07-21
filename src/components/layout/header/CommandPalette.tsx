"use client";

import { History, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { SkillIcon } from "@/components/skills";
import { AppScrollArea } from "@/components/ui/AppScrollArea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isGlobalSearchPreview, useGlobalSearchPreviews, type GlobalSearchPreview } from "@/hooks/useGlobalSearchPreviews";
import { getConnectionRequestSuccessMessage, useConnectionMutations } from "@/hooks/useConnections";
import { resolveClientSkill } from "@/lib/skills/client";
import { SearchPreviewError } from "@/lib/search/contracts";
import {
    ProfileSearchResultCard,
    ProjectSearchResultCard,
    SettingsSearchResultCard,
    TaskSearchResultCard,
} from "./GlobalSearchResultCards";
import {
    OPEN_MESSAGES_SEARCH_EVENT,
    buildGlobalSearchHref,
    getPeopleSearchScope,
    getProjectIdentifierFromPathname,
    getGlobalSearchRecentScope,
    readRecentGlobalSearches,
    removeRecentGlobalSearch,
    rememberRecentGlobalSearch,
    rememberRecentGlobalSearchPreview,
    resolveGlobalSearchContext,
    searchSettings,
    type GlobalSearchContext,
    type RecentGlobalSearchItem,
    type SettingsSearchItem,
} from "./global-search";

type CommandPaletteProps = {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
    context?: GlobalSearchContext;
    recentSearchOwnerId?: string;
};

const CONTEXT_PRESENTATION = {
    default: { label: "Hub / Projects", hints: ["Project name", "Technology", "Category"] },
    hub: { label: "Hub / Projects", hints: ["Project name", "Technology", "Category"] },
    people: { label: "Connections / Builders", hints: ["Name", "Skill", "Location"] },
    project: { label: "Project / Tasks", hints: ["Task title", "Task key", "Description"] },
    settings: { label: "Workspace / Settings", hints: ["Theme", "Privacy", "Integrations"] },
    messages: { label: "Messages", hints: [] },
} satisfies Record<GlobalSearchContext, { label: string; hints: string[] }>;

function resultDomId(result: GlobalSearchPreview | SettingsSearchItem, settings = false) {
    return `global-search-preview-${settings ? `settings-${result.id}` : result.id}`;
}

function SearchSkeletons() {
    return (
        <div className="space-y-2 p-3" aria-label="Loading search previews">
            {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-zinc-200/60 px-3 py-3 dark:border-zinc-800/70">
                    <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-800" />
                    <span className="min-w-0 flex-1 space-y-2">
                        <span className="block h-3 w-1/3 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-800" />
                        <span className="block h-2.5 w-3/4 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-800" />
                        <span className="block h-2.5 w-1/2 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-800" />
                    </span>
                </div>
            ))}
        </div>
    );
}

function RecentSearchList({
    items,
    onSelectQuery,
    onOpenPreview,
    onConnect,
    connectingUserId,
    onRemove,
}: {
    items: RecentGlobalSearchItem[];
    onSelectQuery: (query: string) => void;
    onOpenPreview: (preview: GlobalSearchPreview) => void;
    onConnect: (result: Extract<GlobalSearchPreview, { kind: "profile" }>) => Promise<void>;
    connectingUserId?: string;
    onRemove: (key: string) => void;
}) {
    if (!items.length) return null;
    return (
        <section aria-labelledby="global-search-recents-heading">
            <p id="global-search-recents-heading" className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Recent searches</p>
            <div className="mt-2 space-y-1">
                {items.map((recent) => {
                    if (recent.kind === "preview" && isGlobalSearchPreview(recent.preview)) {
                        const interaction = { index: 0, activeIndex: -1, onActivate: () => undefined, onOpen: onOpenPreview, onRemove: () => onRemove(recent.key) };
                        if (recent.preview.kind === "project") return <ProjectSearchResultCard key={recent.key} result={recent.preview} {...interaction} />;
                        if (recent.preview.kind === "profile") return <ProfileSearchResultCard key={recent.key} result={recent.preview} {...interaction} onConnect={onConnect} isConnecting={connectingUserId === recent.preview.userId} />;
                        if (recent.preview.kind === "task") return <TaskSearchResultCard key={recent.key} result={recent.preview} {...interaction} />;
                    }
                    if (recent.kind !== "query") return null;
                    return (
                        <div key={recent.key} className="group relative flex min-h-10 items-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-within:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 dark:focus-within:bg-zinc-900">
                            <button
                                type="button"
                                onClick={() => onSelectQuery(recent.query)}
                                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 pr-12 text-left text-sm outline-none"
                                aria-label={`Use recent search ${recent.label}`}
                            >
                                <History className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                                <span className="truncate">{recent.label}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onRemove(recent.key)}
                                className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[color,background-color,opacity] hover:bg-zinc-200 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:hover:bg-zinc-800 dark:hover:text-zinc-100 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                aria-label={`Remove ${recent.label} from recent searches`}
                            >
                                <X className="h-4 w-4" aria-hidden />
                            </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export default function CommandPalette({ isOpen, onClose, initialQuery = "", context, recentSearchOwnerId = "" }: CommandPaletteProps) {
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [query, setQuery] = useState(initialQuery);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [recentSearches, setRecentSearches] = useState<RecentGlobalSearchItem[]>([]);
    const { sendRequest } = useConnectionMutations();
    const paramsString = searchParams?.toString() ?? "";
    const currentParams = useMemo(() => new URLSearchParams(paramsString), [paramsString]);
    const routeContext = resolveGlobalSearchContext(pathname, currentParams);
    const searchContext = context ?? routeContext.context;
    const peopleScope = getPeopleSearchScope(currentParams);
    const projectIdentifier = getProjectIdentifierFromPathname(pathname);
    const recentSearchScope = getGlobalSearchRecentScope(searchContext, peopleScope, projectIdentifier);
    const presentation = searchContext === "people" && peopleScope === "network"
        ? { label: "Connections / Network", hints: ["Connection name", "Username"] }
        : CONTEXT_PRESENTATION[searchContext];
    const palettePlaceholder = `Search ${presentation.label}...`;
    const normalizedQuery = query.trim();
    const settingsResults = useMemo(
        () => searchContext === "settings" ? searchSettings(query).slice(0, 10) : [],
        [query, searchContext],
    );
    const previews = useGlobalSearchPreviews({
        context: searchContext,
        query,
        enabled: isOpen,
        projectIdentifier,
        peopleScope,
    });
    const previewResults = previews.isDebouncing ? [] : previews.data ?? [];
    const projectResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "project" }>; index: number } => entry.result.kind === "project");
    const profileResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "profile" }>; index: number } => entry.result.kind === "profile");
    const taskResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "task" }>; index: number } => entry.result.kind === "task");
    const skillResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "skill" }>; index: number } => entry.result.kind === "skill");
    const supportsPreviews = searchContext === "hub" || searchContext === "people" || searchContext === "project" || searchContext === "default";
    const resultCount = searchContext === "settings" ? settingsResults.length : previewResults.length;
    const activeResult = searchContext === "settings" ? settingsResults[activeIndex] : previewResults[activeIndex];
    const isRateLimited = previews.error instanceof SearchPreviewError && previews.error.code === "RATE_LIMITED";

    useEffect(() => {
        if (!isOpen) return;
        setQuery(initialQuery);
        setActiveIndex(searchContext === "settings" ? 0 : -1);
    }, [initialQuery, isOpen, searchContext]);

    useEffect(() => {
        if (!isOpen) return;
        setRecentSearches(readRecentGlobalSearches(recentSearchOwnerId, recentSearchScope).filter(
            (recent) => recent.kind === "query" || isGlobalSearchPreview(recent.preview),
        ));
    }, [isOpen, recentSearchOwnerId, recentSearchScope]);

    useEffect(() => {
        setActiveIndex(searchContext === "settings" ? 0 : -1);
    }, [query, searchContext]);

    useEffect(() => {
        if (activeIndex < 0 || activeIndex >= resultCount) return;
        const result = searchContext === "settings" ? settingsResults[activeIndex] : previewResults[activeIndex];
        if (!result) return;
        document.getElementById(resultDomId(result, searchContext === "settings"))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeIndex, previewResults, resultCount, searchContext, settingsResults]);

    useEffect(() => {
        const href = activeResult?.href;
        if (!isOpen || !href) return;
        const prefetchTimer = window.setTimeout(() => router.prefetch(href), 150);
        return () => window.clearTimeout(prefetchTimer);
    }, [activeResult?.href, isOpen, router]);

    useEffect(() => {
        if (!isOpen || searchContext !== "messages") return;
        window.dispatchEvent(new Event(OPEN_MESSAGES_SEARCH_EVENT));
        onClose();
    }, [isOpen, onClose, searchContext]);

    const recordRecentSearch = (value: string) => {
        setRecentSearches(rememberRecentGlobalSearch(recentSearchOwnerId, recentSearchScope, value));
    };

    const recordRecentPreview = (value: GlobalSearchPreview) => {
        setRecentSearches(rememberRecentGlobalSearchPreview(recentSearchOwnerId, recentSearchScope, value));
    };

    const removeRecentSearch = (key: string) => {
        setRecentSearches(removeRecentGlobalSearch(recentSearchOwnerId, recentSearchScope, key));
    };

    const cancelActivePreviews = () => {
        const previewContext = searchContext === "default" ? "hub" : searchContext;
        queryClient.cancelQueries({
            queryKey: ["global-search", "previews", previewContext],
        });
    };

    const openSettingsResult = (result: SettingsSearchItem) => {
        cancelActivePreviews();
        recordRecentSearch(query);
        router.push(result.href);
        onClose();
    };

    const openPreviewResult = (result: GlobalSearchPreview) => {
        cancelActivePreviews();
        if (result.kind === "skill") recordRecentSearch(result.title);
        else recordRecentPreview(result);
        router.push(result.href);
        onClose();
    };

    const connectProfile = async (result: Extract<GlobalSearchPreview, { kind: "profile" }>) => {
        try {
            await toast.promise(sendRequest.mutateAsync({ userId: result.userId }), {
                loading: "Sending request...",
                success: (response) => getConnectionRequestSuccessMessage(response.status),
                error: (error) => error instanceof Error ? error.message : "Failed to send request",
            });
        } catch {
            // The shared mutation and toast already restore and report the failed state.
        }
    };

    const searchAll = () => {
        const href = buildGlobalSearchHref({
            pathname: pathname || "/",
            searchParams: currentParams,
            context: searchContext,
            query,
        });
        if (!href) return;
        cancelActivePreviews();
        recordRecentSearch(query);
        router.push(href);
        onClose();
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (searchContext === "settings") {
            const result = settingsResults[activeIndex] ?? settingsResults[0];
            if (result) openSettingsResult(result);
            return;
        }
        const preview = activeIndex >= 0 ? previewResults[activeIndex] : undefined;
        if (preview) {
            openPreviewResult(preview);
            return;
        }
        searchAll();
    };

    const moveActive = (direction: 1 | -1) => {
        if (!resultCount) return;
        setActiveIndex((current) => current < 0
            ? direction === 1 ? 0 : resultCount - 1
            : (current + direction + resultCount) % resultCount);
    };

    const moveWithinSkills = (direction: 1 | -1) => {
        if (!skillResults.length) return false;
        const currentSkillPosition = skillResults.findIndex(({ index }) => index === activeIndex);
        if (currentSkillPosition < 0) return false;
        const next = skillResults[(currentSkillPosition + direction + skillResults.length) % skillResults.length];
        if (next) setActiveIndex(next.index);
        return true;
    };

    if (searchContext === "messages") return null;

    const resultLabel = projectResults.length
        ? `${projectResults.length} project${projectResults.length === 1 ? "" : "s"}`
        : profileResults.length
            ? `${profileResults.length} builder${profileResults.length === 1 ? "" : "s"}`
            : taskResults.length
                ? `${taskResults.length} task${taskResults.length === 1 ? "" : "s"}`
                : settingsResults.length
                    ? `${settingsResults.length} setting${settingsResults.length === 1 ? "" : "s"}`
                    : "Results";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                showCloseButton={false}
                overlayClassName="bg-black/45 backdrop-blur-[2px]"
                className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-2xl duration-150 motion-reduce:duration-0 sm:left-1/2 sm:top-[10%] sm:h-auto sm:max-h-[76dvh] sm:w-[min(760px,calc(100vw-2rem))] sm:max-w-[760px] sm:-translate-x-1/2 sm:translate-y-0 sm:rounded-2xl sm:border sm:border-zinc-200/80 dark:sm:border-zinc-800"
                aria-describedby="topnav-search-description"
            >
                <DialogTitle className="sr-only">{presentation.label}</DialogTitle>
                <DialogDescription id="topnav-search-description" className="sr-only">{routeContext.description}</DialogDescription>

                <form onSubmit={handleSubmit} className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
                    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-200/80 px-4 dark:border-zinc-800 sm:px-5">
                        <Search className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
                        <input
                            autoFocus
                            type="search"
                            autoComplete="off"
                            maxLength={100}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    moveActive(1);
                                } else if (event.key === "ArrowUp") {
                                    event.preventDefault();
                                    moveActive(-1);
                                } else if (event.key === "ArrowRight" && moveWithinSkills(1)) {
                                    event.preventDefault();
                                } else if (event.key === "ArrowLeft" && moveWithinSkills(-1)) {
                                    event.preventDefault();
                                }
                            }}
                            placeholder={palettePlaceholder}
                            className="h-full min-w-0 flex-1 bg-transparent text-base font-medium text-zinc-950 outline-none placeholder:font-normal placeholder:text-zinc-400 dark:text-zinc-50 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                            aria-label={palettePlaceholder}
                            role="combobox"
                            aria-expanded={isOpen}
                            aria-autocomplete="list"
                            aria-busy={previews.isFetching || previews.isDebouncing}
                            aria-controls={searchContext === "settings" ? "settings-search-results" : supportsPreviews && normalizedQuery ? "global-search-preview-results" : undefined}
                            aria-activedescendant={activeResult ? resultDomId(activeResult, searchContext === "settings") : undefined}
                        />
                        {normalizedQuery ? (
                            <>
                                <button type="button" onClick={() => setQuery("")} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200 sm:h-8 sm:w-8" aria-label="Clear search"><X className="h-4 w-4" aria-hidden /></button>
                                <span data-testid="global-search-enter-hint" aria-hidden className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                                    <span className="hidden sm:inline">Enter</span><kbd>↵</kbd>
                                </span>
                            </>
                        ) : (
                            <button type="button" onClick={onClose} className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[10px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" aria-label="Close search">
                                <kbd>Esc</kbd>
                            </button>
                        )}
                    </div>

                    <div className="sr-only" aria-live="polite">{previews.isDebouncing
                        ? "Waiting for search input"
                        : previews.isFetching && resultCount === 0
                            ? "Searching"
                            : normalizedQuery.length >= 2
                                ? `${resultCount} preview results`
                                : "Type at least two characters to preview results"}</div>

                    {searchContext === "settings" ? (
                        <div className="flex min-h-0 flex-1 flex-col sm:max-h-[480px]">
                            {!normalizedQuery && recentSearches.length ? <div className="shrink-0 border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800"><RecentSearchList items={recentSearches} onSelectQuery={setQuery} onOpenPreview={openPreviewResult} onConnect={connectProfile} connectingUserId={sendRequest.isPending ? sendRequest.variables?.userId : undefined} onRemove={removeRecentSearch} /></div> : null}
                            <AppScrollArea id="settings-search-results" axis="y" role="listbox" aria-label="Settings search results" className="min-h-0 flex-1 p-2">
                                <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] font-semibold text-zinc-400"><span>Settings</span><span>{settingsResults.length}</span></div>
                                {settingsResults.length ? settingsResults.map((result, index) => (
                                    <SettingsSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openSettingsResult} />
                                )) : (
                                    <div className="px-5 py-12 text-center"><p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">No setting matches “{normalizedQuery}”.</p><p className="mt-1 text-xs text-zinc-500">Try theme, privacy, notifications, or editor.</p></div>
                                )}
                            </AppScrollArea>
                        </div>
                    ) : supportsPreviews ? (
                        <AppScrollArea id="global-search-preview-results" axis="y" role={normalizedQuery ? "listbox" : "region"} aria-busy={previews.isFetching || previews.isDebouncing} aria-label={normalizedQuery ? searchContext === "people" ? "Builder search results" : searchContext === "project" ? "Task search results" : "Project search results" : "Search guidance and recent searches"} className="min-h-0 min-w-0 flex-1 sm:max-h-[480px]">
                            {normalizedQuery.length === 0 ? (
                                <div className="px-5 pt-3 pb-6 sm:pt-3 sm:pb-6">
                                    {recentSearches.length ? (
                                        <RecentSearchList items={recentSearches} onSelectQuery={setQuery} onOpenPreview={openPreviewResult} onConnect={connectProfile} connectingUserId={sendRequest.isPending ? sendRequest.variables?.userId : undefined} onRemove={removeRecentSearch} />
                                    ) : (
                                        /* ponytail: hide Search by options when recent searches are present */
                                        <div>
                                            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Search by</p>
                                            <div className="mt-3 flex flex-wrap gap-2">{presentation.hints.map((hint) => <span key={hint} className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{hint}</span>)}</div>
                                            <p className="mt-4 text-xs text-zinc-400">Start typing to preview matching {searchContext === "people" ? "builders" : searchContext === "project" ? "tasks" : "projects"}.</p>
                                        </div>
                                    )}
                                </div>
                            ) : normalizedQuery.length < 2 ? (
                                <div className="px-5 py-5 text-xs text-zinc-500">Type one more character to preview results.</div>
                            ) : previews.isDebouncing || previews.isFetching && previewResults.length === 0 ? (
                                <SearchSkeletons />
                            ) : previews.isError ? (
                                <div className="flex flex-col items-center px-5 py-12 text-center">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300"><RotateCcw className="h-4 w-4" aria-hidden /></span>
                                    <p className="mt-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">{isRateLimited ? "Search is temporarily paused" : "Preview unavailable"}</p>
                                    <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">{isRateLimited ? "Please wait a moment before trying again." : "Retry the preview or press Enter to run the full search without losing your query."}</p>
                                    {!isRateLimited ? <button type="button" onClick={() => void previews.refetch()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Retry preview</button> : null}
                                </div>
                            ) : previewResults.length === 0 ? (
                                <div className="px-5 py-12 text-center"><p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">No {searchContext === "people" ? "builders" : searchContext === "project" ? "tasks" : "projects"} match “{normalizedQuery}”.</p><p className="mt-1 text-xs text-zinc-500">Try a {presentation.hints.map((hint) => hint.toLowerCase()).join(", ")}.</p></div>
                            ) : (
                                <div className="p-2">
                                    <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] font-semibold text-zinc-400"><span>{resultLabel}</span>{previews.isFetching ? <span>Refreshing…</span> : null}</div>
                                    {projectResults.map(({ result, index }) => <ProjectSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} />)}
                                    {profileResults.map(({ result, index }) => <ProfileSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} onConnect={connectProfile} isConnecting={sendRequest.isPending && sendRequest.variables?.userId === result.userId} />)}
                                    {taskResults.map(({ result, index }) => <TaskSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} />)}
                                    {skillResults.length ? (
                                        <div className="mt-2 border-t border-zinc-200/80 pt-3 dark:border-zinc-800">
                                            <div className="flex items-center justify-between px-3 pb-2 text-[11px] font-semibold text-zinc-400"><span>Skills in these projects</span><span>Scroll to explore</span></div>
                                            <div className="relative before:pointer-events-none before:absolute before:right-0 before:top-0 before:z-10 before:h-full before:w-8 before:bg-gradient-to-l before:from-white before:to-transparent dark:before:from-zinc-950">
                                                <AppScrollArea axis="x" variant="hidden" stableGutter={false} className="flex w-full min-w-0 flex-nowrap gap-2 px-3 pb-2 pr-8" data-testid="related-skills-scroll">
                                                    {skillResults.map(({ result, index }) => (
                                                        <button
                                                            id={resultDomId(result)}
                                                            key={result.id}
                                                            type="button"
                                                            role="option"
                                                            tabIndex={-1}
                                                            aria-selected={index === activeIndex}
                                                            onMouseEnter={() => setActiveIndex(index)}
                                                            onFocus={() => setActiveIndex(index)}
                                                            onClick={() => openPreviewResult(result)}
                                                            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-9 ${index === activeIndex ? "border-primary/40 bg-primary/10 text-primary" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}
                                                        >
                                                            <SkillIcon skill={resolveClientSkill(result.title)} size={15} />{result.title}
                                                        </button>
                                                    ))}
                                                </AppScrollArea>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </AppScrollArea>
                    ) : null}

                </form>
            </DialogContent>
        </Dialog>
    );
}
