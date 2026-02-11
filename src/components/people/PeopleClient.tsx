"use client";

import { useMemo, useState } from "react";
import { Search, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import PersonCard from "@/components/people/PersonCard";
import { useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";

interface PeopleClientProps {
    embedded?: boolean;
    initialUser: { id?: string | null } | null;
}

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

    const handleConnect = async (userId: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to connect");
            return;
        }

        await toast.promise(
            sendRequest.mutateAsync({ userId }),
            {
                loading: "Sending request...",
                success: "Connection request sent",
                error: "Failed to send request",
            },
        );
    };

    const handleDismiss = async (userId: string) => {
        await toast.promise(
            dismissSuggestion.mutateAsync(userId),
            {
                loading: "Hiding suggestion...",
                success: "Suggestion hidden",
                error: "Failed to hide suggestion",
            },
        );
    };

    if (isLoading && profiles.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
        );
    }

    return (
        <div>
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

            {profiles.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                    <Users className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400">
                        {debouncedSearch ? "No people match your search." : "No people found."}
                    </p>
                </div>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {profiles.map((profile) => (
                            <PersonCard
                                key={profile.id}
                                profile={profile}
                                onConnect={handleConnect}
                                onDismiss={handleDismiss}
                            />
                        ))}
                    </div>

                    {hasNextPage && !debouncedSearch && (
                        <div className="mt-8 text-center">
                            <button
                                onClick={() => fetchNextPage()}
                                disabled={isFetchingNextPage}
                                className="px-6 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
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
