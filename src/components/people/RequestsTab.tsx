import { useState, useMemo } from "react";
import { Loader2, UserPlus, X, Check, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { profileHref } from "@/lib/routing/identifiers";
import { usePendingRequests, useConnectionMutations } from "@/hooks/useConnections";
import { toast } from "sonner";
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import ProjectApplicationsSection from "./ProjectApplicationsSection";

interface RequestsTabProps {
    initialUser: any;
    initialRequests?: { incoming: any[], sent: any[] };
    initialApplications?: { my: any[], incoming: any[] };
}

type RequestItem = 
    | { type: 'header'; title: string; count: number; icon: 'incoming' | 'sent' }
    | { type: 'incoming'; request: any }
    | { type: 'sent'; request: any }
    | { type: 'empty' };

export default function RequestsTab({ initialUser, initialRequests, initialApplications }: RequestsTabProps) {
    const { data: requestData, isLoading: requestsLoading } = usePendingRequests();
    const { acceptRequest, rejectRequest, cancelRequest } = useConnectionMutations();

    // Use initial data if available, or fallback to hook data
    const incomingRequests = requestData?.incoming || initialRequests?.incoming || [];
    const sentRequests = requestData?.sent || initialRequests?.sent || [];
    
    // Check loading only if we have NO data at all
    const isLoading = requestsLoading && !initialRequests && incomingRequests.length === 0 && sentRequests.length === 0;

    const hasRequests = incomingRequests.length > 0 || sentRequests.length > 0;

    const handleAccept = async (id: string) => {
        toast.promise(acceptRequest.mutateAsync(id), {
            loading: 'Accepting...',
            success: 'Connection accepted!',
            error: 'Failed to accept'
        });
    };

    const handleReject = async (id: string) => {
        toast.promise(rejectRequest.mutateAsync(id), {
            loading: 'Rejecting...',
            success: 'Request declined',
            error: 'Failed to decline'
        });
    };

    const handleCancel = async (id: string) => {
        toast.promise(cancelRequest.mutateAsync(id), {
            loading: 'Cancelling...',
            success: 'Request cancelled',
            error: 'Failed to cancel'
        });
    };

    const items = useMemo<RequestItem[]>(() => {
        if (!hasRequests) return [{ type: 'empty' }];

        const result: RequestItem[] = [];

        if (incomingRequests.length > 0) {
            result.push({ 
                type: 'header', 
                title: 'Incoming Requests', 
                count: incomingRequests.length, 
                icon: 'incoming' 
            });
            incomingRequests.forEach(req => {
                result.push({ type: 'incoming', request: req });
            });
        }

        if (sentRequests.length > 0) {
            result.push({ 
                type: 'header', 
                title: 'Sent Requests (Pending)', 
                count: sentRequests.length, 
                icon: 'sent' 
            });
            sentRequests.forEach(req => {
                result.push({ type: 'sent', request: req });
            });
        }

        return result;
    }, [incomingRequests, sentRequests, hasRequests]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
        );
    }

    // Removed duplicate isLoading check

    return (
        <div>
            {/* Project Applications Section - Always show application status */}
            <ProjectApplicationsSection initialUser={initialUser} initialApplications={initialApplications} />
            
            {/* Connection Requests Section */}
            {!hasRequests ? (
                <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 mt-6">
                    <UserPlus className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400">No pending connection requests.</p>
                    <Link href="/people?tab=discover" className="text-indigo-600 hover:underline mt-2 inline-block">
                        Discover people to connect with
                    </Link>
                </div>
            ) : (
                <Virtuoso
                    useWindowScroll
                    data={items}
                    itemContent={(_, item) => {
                if (item.type === 'header') {
                    return (
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 mt-8 flex items-center gap-2">
                            {item.icon === 'incoming' ? (
                                <UserPlus className="w-5 h-5 text-indigo-500" />
                            ) : (
                                <Clock className="w-5 h-5 text-yellow-500" />
                            )}
                            {item.title}
                            <span className={`ml-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                                item.icon === 'incoming' 
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>
                                {item.count}
                            </span>
                        </h2>
                    );
                }

                if (item.type === 'incoming') {
                    const req = item.request;
                    const profile = {
                        id: req.requesterId,
                        username: req.requesterUsername,
                        fullName: req.requesterFullName,
                        avatarUrl: req.requesterAvatarUrl,
                        headline: req.requesterHeadline,
                    };
                    const isByMe = acceptRequest.variables === req.id || rejectRequest.variables === req.id;
                    const isProcessing = (acceptRequest.isPending || rejectRequest.isPending) && isByMe;

                    return (
                        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <div className="flex items-start gap-3">
                                <Link href={profileHref(profile)} className="flex-shrink-0">
                                    {profile.avatarUrl ? (
                                        <Image
                                            src={profile.avatarUrl}
                                            alt={profile.fullName || "User"}
                                            width={48}
                                            height={48}
                                            className="w-12 h-12 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                                            {(profile.fullName || profile.username || "U")[0]?.toUpperCase()}
                                        </div>
                                    )}
                                </Link>
                                <div className="flex-1 min-w-0">
                                    <Link
                                        href={profileHref(profile)}
                                        className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 block truncate"
                                    >
                                        {profile.fullName || profile.username || "User"}
                                    </Link>
                                    {profile.headline && (
                                        <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1">
                                            {profile.headline}
                                        </p>
                                    )}
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                        Received {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2 mt-4">
                                <button
                                    onClick={() => handleAccept(req.id)}
                                    disabled={isProcessing}
                                    className="flex-1 px-3 py-2 text-sm rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                                >
                                    {acceptRequest.isPending && acceptRequest.variables === req.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Check className="w-4 h-4" />
                                    )}
                                    Accept
                                </button>
                                <button
                                    onClick={() => handleReject(req.id)}
                                    disabled={isProcessing}
                                    className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                                >
                                    {rejectRequest.isPending && rejectRequest.variables === req.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <X className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                }

                if (item.type === 'sent') {
                    const req = item.request;
                    const profile = {
                        id: req.addresseeId,
                        username: req.addresseeUsername,
                        fullName: req.addresseeFullName,
                        avatarUrl: req.addresseeAvatarUrl,
                        headline: req.addresseeHeadline,
                    };
                    const isProcessing = cancelRequest.isPending && cancelRequest.variables === req.id;

                    return (
                        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <div className="flex items-start gap-3">
                                <Link href={profileHref(profile)} className="flex-shrink-0">
                                    {profile.avatarUrl ? (
                                        <Image
                                            src={profile.avatarUrl}
                                            alt={profile.fullName || "User"}
                                            width={48}
                                            height={48}
                                            className="w-12 h-12 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                                            {(profile.fullName || profile.username || "U")[0]?.toUpperCase()}
                                        </div>
                                    )}
                                </Link>
                                <div className="flex-1 min-w-0">
                                    <Link
                                        href={profileHref(profile)}
                                        className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 block truncate"
                                    >
                                        {profile.fullName || profile.username || "User"}
                                    </Link>
                                    {profile.headline && (
                                        <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1">
                                            {profile.headline}
                                        </p>
                                    )}
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                        Sent {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-4">
                                <button
                                    onClick={() => handleCancel(req.id)}
                                    disabled={isProcessing}
                                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                                >
                                    {isProcessing ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <X className="w-4 h-4" />
                                    )}
                                    Cancel Request
                                </button>
                            </div>
                        </div>
                    );
                }

                return null;
            }}
                />
            )}
        </div>
    );
}
