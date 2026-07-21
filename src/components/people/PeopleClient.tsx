"use client";

import { forwardRef, useCallback, useEffect, useMemo, useState, type HTMLAttributes } from "react";
import Link from "next/link";
import { Loader2, UserPlus, Users } from "lucide-react";
import { VirtuosoGrid } from "react-virtuoso";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import PersonCard from "@/components/people/PersonCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { getConnectionRequestSuccessMessage, useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";
import type { DiscoverFilters } from "@/app/actions/connections";

interface PeopleClientProps {
    initialUser: { id?: string | null } | null;
    searchQuery: string;
}

const GridList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3" />);
GridList.displayName = "DiscoverGridList";
const GridItem = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} className="min-h-[180px]" />);
GridItem.displayName = "DiscoverGridItem";

const FILTER_CHIPS = [
    { id: "senior", label: "Senior+" },
    { id: "mutual", label: "Mutual connections" },
    { id: "shared_projects", label: "Shared projects" },
] as const;
type FilterId = (typeof FILTER_CHIPS)[number]["id"];

function OnboardingCTA() {
    return <div className="mb-8 rounded-2xl border border-primary/10 bg-gradient-to-r from-primary/5 to-primary/10 p-5 dark:border-primary/20 dark:from-primary/10 dark:to-primary/5">
        <div className="flex items-start gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 dark:bg-primary/20"><UserPlus className="w-5 h-5 text-primary" /></div>
            <div><h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Get better suggestions</h3><p className="mt-0.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">Add your skills, interests, and location to improve your suggestions.</p><Link href="/profile?edit=true" className="mt-2.5 inline-flex text-xs font-semibold text-primary transition-colors hover:text-primary/80">Complete your profile</Link></div>
        </div>
    </div>;
}

export default function PeopleClient({ initialUser, searchQuery }: PeopleClientProps) {
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [activeFilters, setActiveFilters] = useState<FilterId[]>([]);
    const [routeScrollParent, setRouteScrollParent] = useState<HTMLElement | null>(() => typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"));

    useEffect(() => { setRouteScrollParent(document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]")); }, []);

    const serverFilters = useMemo((): DiscoverFilters | undefined => activeFilters.length ? {
        seniorPlus: activeFilters.includes("senior") || undefined,
        hasMutuals: activeFilters.includes("mutual") || undefined,
        hasSharedProjects: activeFilters.includes("shared_projects") || undefined,
    } : undefined, [activeFilters]);
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuggestedPeople(20, debouncedSearch, serverFilters);
    const { sendRequest, dismissSuggestion } = useConnectionMutations();
    const profiles = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
    const viewerProjectIds = useMemo(() => {
        const ids = data?.pages[0]?.viewerProjectIds;
        return ids?.length ? new Set(ids) : undefined;
    }, [data?.pages]);
    const viewerSkills = data?.pages[0]?.viewerSkills;
    const isSearching = Boolean(debouncedSearch);
    const isInitialLoading = isLoading && profiles.length === 0;
    const hasWeakRecommendations = !isSearching && profiles.length > 0 && profiles.filter((profile) => (profile.mutualConnections ?? 0) > 0 || Boolean(profile.recommendationReason && profile.recommendationReason !== "Suggested for your network" && profile.recommendationReason !== "Trending in your network")).length < 3;

    const toggleFilter = useCallback((filter: FilterId) => setActiveFilters((current) => current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter]), []);
    const handleConnect = useCallback(async (userId: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to connect");
            return;
        }
        await toast.promise(sendRequest.mutateAsync({ userId }), {
            loading: "Sending request...",
            success: (result) => getConnectionRequestSuccessMessage(result.status),
            error: (error) => error instanceof Error ? error.message : "Failed to send request",
        });
    }, [initialUser?.id, sendRequest]);
    const handleDismiss = useCallback(async (profileId: string) => {
        await toast.promise(dismissSuggestion.mutateAsync({ profileId }), { loading: "Hiding suggestion...", success: "Suggestion hidden", error: "Failed to hide suggestion" });
    }, [dismissSuggestion]);

    return <div>
        <div className="mb-8 flex items-center gap-2 overflow-x-auto pb-1">{FILTER_CHIPS.map((chip) => <button key={chip.id} type="button" onClick={() => toggleFilter(chip.id)} aria-pressed={activeFilters.includes(chip.id)} className={cn("inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-medium", activeFilters.includes(chip.id) ? "border-transparent bg-primary text-primary-foreground" : "text-foreground")}>{chip.label}</button>)}</div>
        {!isSearching && hasWeakRecommendations ? <OnboardingCTA /> : null}
        {isInitialLoading ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-[180px] animate-pulse rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50" />)}</div> : profiles.length === 0 ? <EmptyState icon={Users} title={isSearching ? "No people match your search." : activeFilters.length ? "No profiles match your filters." : "No people found."} description={isSearching ? "Try adjusting your search terms" : undefined} action={activeFilters.length && !isSearching ? <button type="button" onClick={() => setActiveFilters([])} className="rounded-xl bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary/80">Clear filters</button> : undefined} /> : <div style={{ minHeight: 400 }}>
            <VirtuosoGrid
                customScrollParent={routeScrollParent ?? undefined}
                increaseViewportBy={600}
                data={profiles}
                endReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
                components={{ List: GridList, Item: GridItem, Footer: () => isFetchingNextPage ? <div className="col-span-full flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div> : null }}
                itemContent={(index, profile) => <PersonCard profile={profile} onConnect={handleConnect} onDismiss={handleDismiss} priority={index < 6} viewerProjectIds={viewerProjectIds} viewerSkills={viewerSkills} />}
            />
        </div>}
    </div>;
}
