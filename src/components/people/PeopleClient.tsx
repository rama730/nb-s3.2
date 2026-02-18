"use client";

import { useMemo, useState } from "react";
import { Search, Users, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { VirtuosoGrid } from "react-virtuoso";
import { forwardRef } from "react";
import PersonCard from "@/components/people/PersonCard";
import { useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";

interface PeopleClientProps {
    embedded?: boolean;
    initialUser: { id?: string | null } | null;
}

const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pb-8" />
));
GridList.displayName = "DiscoverGridList";

const GridItem = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="h-full" />
));
GridItem.displayName = "DiscoverGridItem";

export default function PeopleClient({ initialUser }: PeopleClientProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch] = useDebounce(searchQuery, 300);

    const {
        data,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useSuggestedPeople(20, debouncedSearch);
    const { sendRequest, dismissSuggestion } = useConnectionMutations();

    const profiles = useMemo(
        () => data?.pages.flatMap((page) => page.items) || [],
        [data],
    );

    // Split: first 3 high-priority as spotlight, rest as stream
    const spotlightProfiles = useMemo(
        () => (debouncedSearch ? [] : profiles.slice(0, 3)),
        [profiles, debouncedSearch],
    );
    const streamProfiles = useMemo(
        () => (debouncedSearch ? profiles : profiles.slice(3)),
        [profiles, debouncedSearch],
    );

    const handleConnect = async (userId: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to connect");
            return;
        }
        await toast.promise(
            sendRequest.mutateAsync({ userId }),
            { loading: "Sending request...", success: "Connection request sent", error: "Failed to send request" },
        );
    };

    const handleDismiss = async (userId: string) => {
        await toast.promise(
            dismissSuggestion.mutateAsync(userId),
            { loading: "Hiding suggestion...", success: "Suggestion hidden", error: "Failed to hide suggestion" },
        );
    };

    if (isLoading && profiles.length === 0) {
        return (
            <div className="space-y-6">
                {/* Search skeleton */}
                <div className="h-12 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl animate-pulse" />
                {/* Spotlight skeleton */}
                <div className="flex gap-4 overflow-hidden">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-52 w-80 rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse shrink-0" />
                    ))}
                </div>
                {/* Grid skeleton */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                        <div key={i} className="h-48 rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Hero Search Bar */}
            <div className="mb-8">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search people by name, skills, interests, location..."
                        className="w-full pl-12 pr-14 py-3.5 rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl text-base focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all placeholder:text-zinc-400"
                        aria-label="Search people"
                    />
                    <button
                        type="button"
                        disabled
                        title="Filters coming soon"
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl text-zinc-400 opacity-60 cursor-not-allowed"
                        aria-label="Filters (coming soon)"
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {profiles.length === 0 ? (
                <div className="text-center py-16 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5">
                    <Users className="w-14 h-14 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400 text-lg font-medium">
                        {debouncedSearch ? "No people match your search." : "No people found."}
                    </p>
                    {debouncedSearch && (
                        <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-1">Try adjusting your search terms</p>
                    )}
                </div>
            ) : (
                <>
                    {/* ── SPOTLIGHT SECTION ── */}
                    {spotlightProfiles.length > 0 && (
                        <div className="mb-8">
                            <div className="flex items-center gap-2 mb-4">
                                <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    People You Should Meet
                                </h2>
                                <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800" />
                            </div>
                            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
                                {spotlightProfiles.map((profile) => (
                                    <PersonCard
                                        key={profile.id}
                                        profile={profile}
                                        onConnect={handleConnect}
                                        onDismiss={handleDismiss}
                                        variant="spotlight"
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── STREAM GRID ── */}
                    {streamProfiles.length > 0 && (
                        <>
                            {spotlightProfiles.length > 0 && (
                                <div className="flex items-center gap-2 mb-4">
                                    <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        More People
                                    </h2>
                                    <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800" />
                                </div>
                            )}
                            <div style={{ minHeight: 400 }}>
                                <VirtuosoGrid
                                    useWindowScroll
                                    data={streamProfiles}
                                    endReached={() => {
                                        if (hasNextPage && !isFetchingNextPage) {
                                            fetchNextPage();
                                        }
                                    }}
                                    components={{
                                        List: GridList,
                                        Item: GridItem,
                                        Footer: () => isFetchingNextPage ? (
                                            <div className="col-span-full flex justify-center py-6">
                                                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                                            </div>
                                        ) : null,
                                    }}
                                    itemContent={(_, profile) => (
                                        <PersonCard
                                            profile={profile}
                                            onConnect={handleConnect}
                                            onDismiss={handleDismiss}
                                        />
                                    )}
                                />
                            </div>
                        </>
                    )}

                    {/* If we only have spotlight but no stream, and there's more to load */}
                    {streamProfiles.length === 0 && hasNextPage && (
                        <div className="mt-6 text-center">
                            <button
                                onClick={() => fetchNextPage()}
                                disabled={isFetchingNextPage}
                                className="px-6 py-2.5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/60 dark:border-white/10 rounded-xl text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                            >
                                {isFetchingNextPage ? "Loading..." : "Load More"}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
