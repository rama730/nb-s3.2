"use client";

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from "react";
import { Search, Users, Loader2, Sparkles, Globe, Briefcase, UserPlus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { VirtuosoGrid } from "react-virtuoso";
import PersonCard from "@/components/people/PersonCard";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";
import type { DiscoverConnectionItem } from "@/hooks/useConnections";
import { checkConnectionStatus, trackDiscoverImpressions, type DiscoverFilters } from "@/app/actions/connections";

interface PeopleClientProps {
    initialUser: { id?: string | null } | null;
}

type DismissSnapshot = Awaited<ReturnType<ReturnType<typeof useConnectionMutations>["optimisticallyDismissSuggestion"]>>;

type DismissEntry = {
    timer: NodeJS.Timeout | null;
    snapshot: DismissSnapshot;
    persisted: boolean;
};

const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 pb-8" />
));
GridList.displayName = "DiscoverGridList";

const GridItem = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="min-h-[180px]" />
));
GridItem.displayName = "DiscoverGridItem";

// ── Topic Lane ──────────────────────────────────────────────────────

function TopicLane({
    title,
    icon,
    profiles,
    onConnect,
    onDismiss,
    onDisconnect,
    viewerProjectIds,
    viewerSkills,
    viewerLocation,
    lane,
    registerImpressionCard,
}: {
    title: string;
    icon: React.ReactNode;
    profiles: DiscoverConnectionItem[];
    onConnect: (userId: string, lane?: string) => Promise<void>;
    onDismiss: (userId: string) => Promise<void>;
    onDisconnect: (userId: string, connectionId?: string) => Promise<void>;
    viewerProjectIds?: Set<string>;
    viewerSkills?: string[];
    viewerLocation?: string | null;
    lane?: string;
    registerImpressionCard: (profileId: string) => (el: HTMLDivElement | null) => void;
}) {
    const handleLaneConnect = useCallback(
        (userId: string) => onConnect(userId, lane),
        [onConnect, lane],
    );

    if (profiles.length === 0) return null;

    return (
        <section className="mb-8">
            <div className="flex items-center gap-2 mb-4 px-1">
                {icon}
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tracking-tight">{title}</h2>
                <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                    {profiles.length}
                </span>
                <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800 ml-2" />
            </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {profiles.map((profile) => (
                    <div key={profile.id} data-profile-id={profile.id} ref={registerImpressionCard(profile.id)}>
                        <PersonCard
                            profile={profile}
                            onConnect={handleLaneConnect}
                            onDismiss={onDismiss}
                            onDisconnect={onDisconnect}
                            variant="discover"
                            viewerProjectIds={viewerProjectIds}
                            viewerSkills={viewerSkills}
                            viewerLocation={viewerLocation}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

// ── New user onboarding CTA (idea 4) ───────────────────────────────

function OnboardingCTA() {
    return (
        <div className="mb-8 p-5 rounded-2xl bg-gradient-to-r from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/5 border border-primary/10 dark:border-primary/20">
            <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <UserPlus className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Get better suggestions
                    </h3>
                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                        Add your skills, interests, and location to your profile so we can recommend people you&apos;ll want to work with.
                    </p>
                    <Link
                        href="/profile?edit=true"
                        className="inline-flex items-center gap-1.5 mt-2.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                        Complete your profile
                    </Link>
                </div>
            </div>
        </div>
    );
}

// ── Main Component ──────────────────────────────────────────────────

// ── Filter chip definitions ──────────────────────────────────────────
const FILTER_CHIPS = [
    { id: "available", label: "Available now" },
    { id: "senior", label: "Senior+" },
    { id: "mutual", label: "Mutual connections" },
    { id: "shared_projects", label: "Shared projects" },
] as const;

type FilterId = (typeof FILTER_CHIPS)[number]["id"];

export default function PeopleClient({ initialUser }: PeopleClientProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [activeFilters, setActiveFilters] = useState<Set<FilterId>>(new Set());
    const [routeScrollParent, setRouteScrollParent] = useState<HTMLElement | null>(() => {
        if (typeof document === "undefined") return null;
        return document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]");
    });

    useEffect(() => {
        setRouteScrollParent(document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"));
    }, []);

    // 3F: Convert filter chips to server-side filters
    const serverFilters = useMemo((): DiscoverFilters | undefined => {
        if (activeFilters.size === 0) return undefined;
        return {
            available: activeFilters.has("available") || undefined,
            seniorPlus: activeFilters.has("senior") || undefined,
            hasMutuals: activeFilters.has("mutual") || undefined,
            hasSharedProjects: activeFilters.has("shared_projects") || undefined,
        };
    }, [activeFilters]);

    const {
        data,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useSuggestedPeople(20, debouncedSearch, serverFilters);
    const {
        sendRequest,
        dismissSuggestion,
        optimisticallyDismissSuggestion,
        restoreDismissedSuggestion,
        undoDismiss,
        disconnect,
    } = useConnectionMutations();

    // ── Undo dismiss: deferred pattern with 10s timer ────────────────
    const dismissTimers = useRef<Map<string, DismissEntry>>(new Map());

    // Clean up timers on unmount
    useEffect(() => {
        const timers = dismissTimers.current;
        return () => {
            timers.forEach((entry) => {
                if (entry.timer) clearTimeout(entry.timer);
            });
            timers.clear();
        };
    }, []);

    const profiles = useMemo(
        () => data?.pages.flatMap((page) => page.items) || [],
        [data],
    );

    // Extract viewer's project IDs from the first page response (idea 5)
    const viewerProjectIds = useMemo(() => {
        const ids = data?.pages[0]?.viewerProjectIds;
        return ids && ids.length > 0 ? new Set(ids) : undefined;
    }, [data?.pages]);

    // Extract viewer's skills from first page
    const viewerSkills = useMemo(
        () => data?.pages[0]?.viewerSkills,
        [data?.pages],
    );
    const viewerLocation = useMemo(
        () => data?.pages[0]?.viewerLocation ?? null,
        [data?.pages],
    );

    // 3F: Server-side filters handle filtering — no client-side filtering needed
    const filteredProfiles = profiles;

    const toggleFilter = useCallback((id: FilterId) => {
        setActiveFilters((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const isSearching = !!debouncedSearch;

    // Detect weak recommendations — show onboarding CTA (idea 4)
    const hasWeakRecommendations = useMemo(() => {
        if (isSearching || filteredProfiles.length === 0) return false;
        const meaningful = filteredProfiles.filter(p =>
            (p.mutualConnections ?? 0) > 0 ||
            (p.recommendationReason && p.recommendationReason !== "Suggested for your network" && p.recommendationReason !== "Trending in your network")
        );
        return meaningful.length < 3;
    }, [filteredProfiles, isSearching]);

    // 3G: Single-pass lane splitting — O(n) instead of 4x .filter()
    const { mutualProfiles, contextProfiles, roleProfiles, streamProfiles } = useMemo(() => {
        if (isSearching) return { mutualProfiles: [], contextProfiles: [], roleProfiles: [], streamProfiles: filteredProfiles };

        const mutual: DiscoverConnectionItem[] = [];
        const role: DiscoverConnectionItem[] = [];
        const context: DiscoverConnectionItem[] = [];
        const stream: DiscoverConnectionItem[] = [];

        for (const p of filteredProfiles) {
            if ((p.mutualConnections ?? 0) > 0 && mutual.length < 6) {
                mutual.push(p);
            } else if (p.recommendationReason?.match(/role|project/i) && role.length < 6) {
                role.push(p);
            } else if (
                (p.recommendationReason?.match(/skill|interest/i) || p.location || (p.projects && p.projects.length > 0)) &&
                context.length < 6
            ) {
                context.push(p);
            } else {
                stream.push(p);
            }
        }

        return { mutualProfiles: mutual, contextProfiles: context, roleProfiles: role, streamProfiles: stream };
    }, [filteredProfiles, isSearching]);

    const handleConnect = useCallback(async (userId: string, lane?: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to connect");
            return;
        }
        await toast.promise(
            sendRequest.mutateAsync({ userId, lane }),
            { loading: "Sending request...", success: "Connection request sent", error: "Failed to send request" },
        );
    }, [initialUser?.id, sendRequest]);

    const handleDisconnect = useCallback(async (userId: string, connectionId?: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to manage connections");
            return;
        }

        await toast.promise(
            (async () => {
                const resolvedConnectionId = connectionId || (await checkConnectionStatus(userId)).connectionId;
                if (!resolvedConnectionId) {
                    throw new Error("Connection record not found");
                }
                return disconnect.mutateAsync(resolvedConnectionId);
            })(),
            { loading: "Disconnecting...", success: "Disconnected", error: "Failed to disconnect" },
        );
    }, [disconnect, initialUser?.id]);

    const handleDismiss = useCallback(async (userId: string) => {
        const toastId = `dismiss-${userId}`;

        const existingTimer = dismissTimers.current.get(userId);
        if (existingTimer?.timer) {
            clearTimeout(existingTimer.timer);
        }

        const snapshot = await optimisticallyDismissSuggestion(userId);

        const entry: DismissEntry = {
            timer: null,
            snapshot,
            persisted: false,
        };
        const timer = setTimeout(() => {
            const current = dismissTimers.current.get(userId);
            if (!current) return;
            current.timer = null;
            current.persisted = true;
            dismissSuggestion.mutate(
                { profileId: userId },
                {
                    onSettled: () => {
                        dismissTimers.current.delete(userId);
                    },
                },
            );
        }, 10_000);
        entry.timer = timer;
        dismissTimers.current.set(userId, entry);

        toast("Suggestion hidden", {
            id: toastId,
            duration: 10_000,
            action: {
                label: "Undo",
                onClick: () => {
                    const pendingDismiss = dismissTimers.current.get(userId);
                    if (!pendingDismiss) return;

                    if (!pendingDismiss.persisted) {
                        if (pendingDismiss.timer) {
                            clearTimeout(pendingDismiss.timer);
                        }
                        dismissTimers.current.delete(userId);
                        restoreDismissedSuggestion(pendingDismiss.snapshot);
                        return;
                    }

                    undoDismiss.mutate(userId);
                    dismissTimers.current.delete(userId);
                },
            },
        });
    }, [dismissSuggestion, optimisticallyDismissSuggestion, restoreDismissedSuggestion, undoDismiss]);

    // ── Engagement tracking (idea 11) ────────────────────────────────
    const impressionBuffer = useRef<Set<string>>(new Set());
    const impressionTimer = useRef<NodeJS.Timeout | null>(null);

    const trackImpression = useCallback((profileId: string) => {
        impressionBuffer.current.add(profileId);
        if (impressionTimer.current) clearTimeout(impressionTimer.current);
        impressionTimer.current = setTimeout(() => {
            const ids = Array.from(impressionBuffer.current);
            impressionBuffer.current.clear();
            if (ids.length > 0) {
                trackDiscoverImpressions(ids).catch(() => {/* fire-and-forget */});
            }
        }, 2_000);
    }, []);

    // Track visible profiles on scroll via IntersectionObserver
    const observerRef = useRef<IntersectionObserver | null>(null);
    const observedCards = useRef<Map<string, Element>>(new Map());

    const registerImpressionCard = useCallback((profileId: string) => {
        return (el: HTMLDivElement | null) => {
            const prev = observedCards.current.get(profileId);
            if (prev && prev !== el) {
                observerRef.current?.unobserve(prev);
                observedCards.current.delete(profileId);
            }
            if (el) {
                observedCards.current.set(profileId, el);
                observerRef.current?.observe(el);
            } else {
                observedCards.current.delete(profileId);
            }
        };
    }, []);

    useEffect(() => {
        observerRef.current = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const profileId = (entry.target as HTMLElement).dataset.profileId;
                        if (profileId) trackImpression(profileId);
                    }
                }
            },
            { threshold: 0.5 },
        );
        // Observe any already-tracked elements
        observedCards.current.forEach((el) => observerRef.current?.observe(el));
        return () => {
            observerRef.current?.disconnect();
            if (impressionTimer.current) clearTimeout(impressionTimer.current);
        };
    }, [trackImpression]);

    const hasAnyLane = mutualProfiles.length > 0 || contextProfiles.length > 0 || roleProfiles.length > 0;

    // ── Loading skeleton ────────────────────────────────────────────
    if (isLoading && profiles.length === 0) {
        return (
            <div className="space-y-6">
                <div className="h-12 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl animate-pulse" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-[180px] rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Search Bar */}
            <div className="mb-4 relative z-20">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search people by name, skills, interests, location..."
                        className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl text-base focus:ring-2 focus:ring-ring/40 focus:border-primary/40 transition-all shadow-sm placeholder:text-zinc-400"
                        aria-label="Search people"
                    />
                </div>
            </div>

            {/* Filter Chips */}
            <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-1">
                {FILTER_CHIPS.map((chip) => (
                    <Badge
                        key={chip.id}
                        variant={activeFilters.has(chip.id) ? "default" : "outline"}
                        className="cursor-pointer select-none whitespace-nowrap text-xs px-3 py-1"
                        onClick={() => toggleFilter(chip.id)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleFilter(chip.id);
                            }
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={activeFilters.has(chip.id)}
                    >
                        {chip.label}
                    </Badge>
                ))}
            </div>

            {/* Onboarding CTA (idea 4) */}
            {!isSearching && hasWeakRecommendations && <OnboardingCTA />}

            {profiles.length === 0 ? (
                <EmptyState
                    icon={Users}
                    title={
                        isSearching
                            ? "No people match your search."
                            : activeFilters.size > 0
                                ? "No profiles match your filters."
                                : "No people found."
                    }
                    description={isSearching ? "Try adjusting your search terms" : undefined}
                    action={
                        activeFilters.size > 0 && !isSearching ? (
                            <button
                                onClick={() => setActiveFilters(new Set())}
                                className="px-4 py-2 text-sm font-medium text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 rounded-xl transition-colors"
                            >
                                Clear filters
                            </button>
                        ) : undefined
                    }
                />
            ) : (
                <>
                    {/* ── Topic Lanes (browse mode only) ── */}
                    {!isSearching && (
                        <>
                            <TopicLane
                                title="People You May Know"
                                icon={<Sparkles className="w-4 h-4 text-primary" />}
                                profiles={mutualProfiles}
                                onConnect={handleConnect}
                                onDismiss={handleDismiss}
                                onDisconnect={handleDisconnect}
                                viewerProjectIds={viewerProjectIds}
                                viewerSkills={viewerSkills}
                                viewerLocation={viewerLocation}
                                lane="mutual"
                                registerImpressionCard={registerImpressionCard}
                            />
                            <TopicLane
                                title="For Your Projects"
                                icon={<Briefcase className="w-4 h-4 text-violet-500" />}
                                profiles={roleProfiles}
                                onConnect={handleConnect}
                                onDismiss={handleDismiss}
                                onDisconnect={handleDisconnect}
                                viewerProjectIds={viewerProjectIds}
                                viewerSkills={viewerSkills}
                                viewerLocation={viewerLocation}
                                lane="role"
                                registerImpressionCard={registerImpressionCard}
                            />
                            <TopicLane
                                title="Based on Your Profile"
                                icon={<Globe className="w-4 h-4 text-emerald-500" />}
                                profiles={contextProfiles}
                                onConnect={handleConnect}
                                onDismiss={handleDismiss}
                                onDisconnect={handleDisconnect}
                                viewerProjectIds={viewerProjectIds}
                                viewerSkills={viewerSkills}
                                viewerLocation={viewerLocation}
                                lane="context"
                                registerImpressionCard={registerImpressionCard}
                            />
                        </>
                    )}

                    {/* ── Grid ── */}
                    {streamProfiles.length > 0 && (
                        <>
                            {!isSearching && hasAnyLane && (
                                <div className="flex items-center gap-2 mb-4 px-1">
                                    <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        Everyone
                                    </h2>
                                    <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800" />
                                </div>
                            )}
                            <div style={{ minHeight: 400 }}>
                                <VirtuosoGrid
                                    customScrollParent={routeScrollParent ?? undefined}
                                    increaseViewportBy={600}
                                    data={streamProfiles}
                                    endReached={() => {
                                        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
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
                                    itemContent={(index, profile) => (
                                        <div data-profile-id={profile.id} ref={registerImpressionCard(profile.id)}>
                                            <PersonCard
                                                profile={profile}
                                                onConnect={handleConnect}
                                                onDismiss={handleDismiss}
                                                onDisconnect={handleDisconnect}
                                                variant="discover"
                                                priority={index < 6}
                                                viewerProjectIds={viewerProjectIds}
                                                viewerSkills={viewerSkills}
                                                viewerLocation={viewerLocation}
                                            />
                                        </div>
                                    )}
                                />
                            </div>
                        </>
                    )}

                    {streamProfiles.length === 0 && hasNextPage && (
                        <div className="mt-6 text-center">
                            <button
                                onClick={() => fetchNextPage()}
                                disabled={isFetchingNextPage}
                                className="px-6 py-2.5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/60 dark:border-white/10 rounded-xl text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 shadow-sm"
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
