"use client";

import { useState, useEffect } from "react";
import { Loader2, UserPlus, Users, Briefcase, Check, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { InboxData } from "@/types/people";
import { usePendingRequests, useConnectionMutations } from "@/hooks/useConnections";
import { toast } from "sonner";

interface PeopleInboxTabProps {
    initialUser: any;
    inboxPromise?: Promise<InboxData>;
}

export default function PeopleInboxTab({ initialUser, inboxPromise }: PeopleInboxTabProps) {
    const { data: requestData, isLoading: requestsLoading } = usePendingRequests();
    const { acceptRequest, rejectRequest } = useConnectionMutations();

    // Flatten incoming requests
    const incomingRequests = requestData?.incoming || [];

    const [hydrated, setHydrated] = useState(false);
    const [inboxData, setInboxData] = useState<InboxData | null>(null);

    // Initial hydration if promise provided
    useEffect(() => {
        async function hydrate() {
            if (inboxPromise && !hydrated && incomingRequests.length === 0) {
                try {
                    const data = await inboxPromise;
                    setInboxData(data);
                    // Note: with React Query, we usually rely on the query cache rather than manual hydration from props,
                    // but we can keep this for initial SSR data if we wanted to seed the query cache.
                    // For simplicity, we'll let the query fetch fresh data or display what's provided.
                    setHydrated(true);
                } catch (e) { console.error(e); }
            } else if (!inboxPromise) {
                setHydrated(true);
            }
        }
        hydrate();
    }, [inboxPromise, hydrated, incomingRequests.length]);

    // Use query state
    const loading = requestsLoading && incomingRequests.length === 0;

    const handleAccept = async (id: string) => {
        toast.promise(acceptRequest.mutateAsync(id), {
            loading: 'Accepting...',
            success: 'Connection accepted',
            error: 'Failed to accept'
        });
    };

    const handleReject = async (id: string) => {
        try {
            await rejectRequest.mutateAsync(id);
            // Toast handled by mutation
        } catch (e) { console.error(e); }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
        );
    }

    const hasRequests = incomingRequests.length > 0;
    const hasProjectInvites = (inboxData?.incomingProjectInvites?.length ?? 0) > 0;
    const hasItems = hasRequests || hasProjectInvites;

    if (!hasItems) {
        return (
            <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <Users className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                <p className="text-zinc-600 dark:text-zinc-400">Your inbox is empty.</p>
                <Link href="/people?tab=discover" className="text-indigo-600 hover:underline mt-2 inline-block">
                    Discover people to connect with
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Connection Requests */}
            {incomingRequests.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                        <UserPlus className="w-5 h-5" />
                        Connection Requests ({incomingRequests.length})
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {incomingRequests.map((req) => (
                            <div
                                key={req.id}
                                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                            >
                                <div className="flex items-center gap-3">
                                    {req.requesterAvatarUrl ? (
                                        <Image
                                            src={req.requesterAvatarUrl}
                                            alt={req.requesterFullName || "User"}
                                            width={40}
                                            height={40}
                                            className="w-10 h-10 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                                            {(req.requesterFullName || "U")[0]?.toUpperCase()}
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <Link href={`/u/${req.requesterUsername}`} className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 truncate block">
                                            {req.requesterFullName || req.requesterUsername || "User"}
                                        </Link>
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-3">
                                    <button
                                        onClick={() => handleAccept(req.id)}
                                        className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1"
                                    >
                                        <Check className="w-4 h-4" />
                                        Accept
                                    </button>
                                    <button
                                        onClick={() => handleReject(req.id)}
                                        className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Project Invites */}
            {inboxData?.incomingProjectInvites && inboxData.incomingProjectInvites.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                        <Briefcase className="w-5 h-5" />
                        Project Invites ({inboxData.incomingProjectInvites.length})
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {inboxData.incomingProjectInvites.map((inv: any) => (
                            <div
                                key={inv.id}
                                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                            >
                                <p className="font-medium text-zinc-900 dark:text-zinc-100">{inv.project?.title || "Project"}</p>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Role: {inv.role}</p>
                                <div className="flex gap-2 mt-3">
                                    <button className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                                        Accept
                                    </button>
                                    <button className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                                        Decline
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
