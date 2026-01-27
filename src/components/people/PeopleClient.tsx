"use client";

import { useState, useEffect } from "react";
import { Search, Users, Loader2 } from "lucide-react";
import PersonCard from "@/components/people/PersonCard";
import { getSuggestedPeople, type SuggestedProfile } from "@/app/actions/connections";
import { toast } from "sonner";
import { useConnectionMutations } from "@/hooks/useConnections";
import { profileHref } from "@/lib/routing/identifiers";

interface PeopleClientProps {
    embedded?: boolean;
    initialProfiles?: any[];
    initialUser: any;
    initialFacetProjectTags?: any[];
    initialFacetSkills?: any[];
    initialFacetLocations?: any[];
    profilesPromise?: Promise<any>;
    connectionsPromise?: Promise<any>;
    facetsPromise?: Promise<any>;
}

export default function PeopleClient({
    embedded = false,
    initialUser,
    initialProfiles = [],
}: PeopleClientProps) {
    const [profiles, setProfiles] = useState<SuggestedProfile[]>(initialProfiles);
    const [loading, setLoading] = useState(initialProfiles.length === 0);
    const [searchQuery, setSearchQuery] = useState("");
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(initialProfiles.length);

    const { sendRequest } = useConnectionMutations();

    // Fetch suggested people on mount ONLY if no initial data
    useEffect(() => {
        if (initialProfiles.length > 0) return;

        async function fetchProfiles() {
            try {
                const { profiles: data, hasMore: more } = await getSuggestedPeople(20, 0);
                setProfiles(data);
                setHasMore(more);
                setOffset(20);
            } catch (error) {
                console.error("Error loading profiles:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchProfiles();
    }, [initialProfiles.length]);

    // Load more profiles
    const loadMore = async () => {
        if (!hasMore || loading) return;

        try {
            const { profiles: data, hasMore: more } = await getSuggestedPeople(20, offset);
            setProfiles(prev => [...prev, ...data]);
            setHasMore(more);
            setOffset(prev => prev + 20);
        } catch (error) {
            console.error("Error loading more profiles:", error);
        }
    };

    // Handle connection request
    const handleConnect = async (userId: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to connect");
            return;
        }

        const profile = profiles.find(p => p.id === userId);
        if (!profile) return;

        toast.promise(
            sendRequest.mutateAsync({ userId: userId }),
            {
                loading: 'Sending request...',
                success: 'Connection request sent!',
                error: 'Failed to send request'
            }
        );

        // Also update local state to reflect change immediately 
        // Note: Ideally we'd re-fetch suggestions or have the card subscribe to status,
        // but for suggestions list simple local state update is often enough or we let React Query invalidate?
        // Since getSuggestedPeople isn't a React Query hook yet (it's called in useEffect), we manually update logic.
        // Actually, sendRequest invalidates 'connections' keys, but maybe not 'suggested-people' if we haven't defined that key yet.
        // Let's manually update UI for responsiveness.
        setProfiles(prev =>
            prev.map(p =>
                p.id === userId ? { ...p, connectionStatus: 'pending_sent' as const } : p
            )
        );
    };

    // Filter profiles by search query
    const filteredProfiles = searchQuery.trim()
        ? profiles.filter((p) => {
            const q = searchQuery.toLowerCase();
            return (
                (p.fullName && p.fullName.toLowerCase().includes(q)) ||
                (p.username && p.username.toLowerCase().includes(q)) ||
                (p.headline && p.headline.toLowerCase().includes(q)) ||
                (p.location && p.location.toLowerCase().includes(q))
            );
        })
        : profiles;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
        );
    }

    return (
        <div>
            {/* Search */}
            <div className="mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search people by name, headline, or location..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        aria-label="Search people"
                    />
                </div>
            </div>

            {/* People Grid */}
            {filteredProfiles.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                    <Users className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400">
                        {searchQuery ? "No people match your search." : "No people found."}
                    </p>
                </div>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredProfiles.map((profile) => (
                            <PersonCard
                                key={profile.id}
                                profile={profile}
                                onConnect={handleConnect}
                            />
                        ))}
                    </div>

                    {/* Load More */}
                    {hasMore && !searchQuery && (
                        <div className="mt-8 text-center">
                            <button
                                onClick={loadMore}
                                className="px-6 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            >
                                Load More
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
