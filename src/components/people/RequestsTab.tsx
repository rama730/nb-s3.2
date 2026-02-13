import { useMemo } from "react";
import { Loader2, UserPlus, X, Check, Clock, CheckCheck, Briefcase } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { profileHref } from "@/lib/routing/identifiers";
import {
    usePendingRequests,
    useRequestHistory,
    useConnectionMutations,
    type PendingIncomingRequest,
    type PendingSentRequest,
    type RequestHistoryItem,
} from "@/hooks/useConnections";
import { toast } from "sonner";
import { Virtuoso } from 'react-virtuoso';
import ProjectApplicationsSection from "./ProjectApplicationsSection";
import type { IncomingApplication, MyApplication } from "./ProjectApplicationsSection";

interface RequestsTabProps {
    initialUser: { id?: string | null } | null;
    initialRequests?: { incoming: PendingIncomingRequest[]; sent: PendingSentRequest[] };
    initialApplications?: { my: MyApplication[]; incoming: IncomingApplication[] };
}

type RequestItem = 
    | { type: 'header'; title: string; count: number; icon: 'incoming' | 'sent' }
    | { type: 'incoming'; request: PendingIncomingRequest }
    | { type: 'sent'; request: PendingSentRequest }
    | { type: 'empty' };

const HISTORY_STATUS_STYLES: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    rejected: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    cancelled: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    disconnected: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    withdrawn: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    role_filled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const HISTORY_STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    disconnected: 'Disconnected',
    withdrawn: 'Withdrawn',
    role_filled: 'Role Filled',
};

function getHistorySummary(item: RequestHistoryItem) {
    if (item.source === 'connection') {
        switch (item.status) {
            case 'pending':
                return item.direction === 'incoming'
                    ? 'Sent you a connection request'
                    : 'You sent a connection request';
            case 'accepted':
                return item.direction === 'incoming'
                    ? 'Connection request accepted'
                    : 'You connected';
            case 'rejected':
                return item.direction === 'incoming'
                    ? 'You declined the request'
                    : 'Your request was declined';
            case 'cancelled':
                return item.direction === 'outgoing'
                    ? 'You cancelled the request'
                    : 'Request was cancelled';
            case 'disconnected':
                return 'Connection was removed';
            default:
                return 'Connection update';
        }
    }

    const safeRoleTitle = item.roleTitle || 'a role';

    switch (item.status) {
        case 'pending':
            return item.direction === 'incoming'
                ? `Applied for ${safeRoleTitle}`
                : `You applied for ${safeRoleTitle}`;
        case 'accepted':
            return item.direction === 'incoming'
                ? `You accepted this application`
                : `Accepted for ${safeRoleTitle}`;
        case 'rejected':
            return item.direction === 'incoming'
                ? `You rejected this application`
                : `Application was rejected`;
        case 'withdrawn':
            return 'Application was withdrawn';
        case 'role_filled':
            return 'Role was filled';
        default:
            return 'Application update';
    }
}

export default function RequestsTab({ initialUser, initialRequests, initialApplications }: RequestsTabProps) {
    const { data: requestData, isLoading: requestsLoading } = usePendingRequests();
    const { data: requestHistoryData, isLoading: historyLoading } = useRequestHistory(80);
    const { acceptRequest, rejectRequest, undoRejectRequest, cancelRequest, acceptAllIncoming, rejectAllIncoming } = useConnectionMutations();

    // Use initial data if available, or fallback to hook data
    const incomingRequests = useMemo(
        () => requestData?.incoming || initialRequests?.incoming || [],
        [requestData?.incoming, initialRequests?.incoming],
    );
    const sentRequests = useMemo(
        () => requestData?.sent || initialRequests?.sent || [],
        [requestData?.sent, initialRequests?.sent],
    );
    
    // Check loading only if we have NO data at all
    const isLoading = requestsLoading && !initialRequests && incomingRequests.length === 0 && sentRequests.length === 0;

    const hasRequests = incomingRequests.length > 0 || sentRequests.length > 0;
    const historyItems = requestHistoryData?.items || [];

    const handleAccept = async (id: string) => {
        toast.promise(acceptRequest.mutateAsync(id), {
            loading: 'Accepting...',
            success: 'Connection accepted!',
            error: 'Failed to accept'
        });
    };

    const handleReject = async (id: string) => {
        const pendingToast = toast.loading('Rejecting...');
        try {
            const result = await rejectRequest.mutateAsync(id);
            toast.dismiss(pendingToast);
            toast.success('Request declined');

            if (result?.undoUntil) {
                toast('Request declined', {
                    description: 'Undo available for 15 seconds.',
                    action: {
                        label: 'Undo',
                        onClick: () => {
                            void toast.promise(undoRejectRequest.mutateAsync(id), {
                                loading: 'Restoring...',
                                success: 'Request restored',
                                error: 'Failed to restore request',
                            });
                        },
                    },
                });
            }
        } catch {
            toast.dismiss(pendingToast);
            toast.error('Failed to decline');
        }
    };

    const handleCancel = async (id: string) => {
        toast.promise(cancelRequest.mutateAsync(id), {
            loading: 'Cancelling...',
            success: 'Request cancelled',
            error: 'Failed to cancel'
        });
    };

    const handleAcceptAll = async () => {
        if (incomingRequests.length === 0) return;
        const confirmed = confirm(`Accept all ${incomingRequests.length} incoming requests?`);
        if (!confirmed) return;

        const pendingToast = toast.loading('Accepting all requests...');
        try {
            const result = await acceptAllIncoming.mutateAsync(incomingRequests.length);
            toast.dismiss(pendingToast);
            toast.success(`Accepted ${result.acceptedCount || 0} request${result.acceptedCount === 1 ? '' : 's'}.`);
        } catch {
            toast.dismiss(pendingToast);
            toast.error('Failed to accept all requests');
        }
    };

    const handleRejectAll = async () => {
        if (incomingRequests.length === 0) return;
        const confirmed = confirm(`Reject all ${incomingRequests.length} incoming requests? This cannot be undone in bulk.`);
        if (!confirmed) return;

        const pendingToast = toast.loading('Rejecting all requests...');
        try {
            const result = await rejectAllIncoming.mutateAsync(incomingRequests.length);
            toast.dismiss(pendingToast);
            toast.success(`Rejected ${result.rejectedCount || 0} request${result.rejectedCount === 1 ? '' : 's'}.`);
        } catch {
            toast.dismiss(pendingToast);
            toast.error('Failed to reject all requests');
        }
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
                        <div className="mb-4 mt-8 flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
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
                            {item.icon === 'incoming' && item.count > 1 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleAcceptAll}
                                        disabled={acceptAllIncoming.isPending || rejectAllIncoming.isPending}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/60 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300 transition-colors disabled:opacity-50"
                                    >
                                        <CheckCheck className="w-3.5 h-3.5" />
                                        Accept all
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRejectAll}
                                        disabled={acceptAllIncoming.isPending || rejectAllIncoming.isPending}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/60 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/20 dark:text-red-300 transition-colors disabled:opacity-50"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        Reject all
                                    </button>
                                </div>
                            )}
                        </div>
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

            <div className="mt-8">
                <div className="mb-4 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-zinc-500" />
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Request History</h2>
                </div>

                {historyLoading && historyItems.length === 0 ? (
                    <div className="flex items-center justify-center rounded-2xl border border-zinc-200 bg-white py-8 dark:border-zinc-800 dark:bg-zinc-900">
                        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                    </div>
                ) : historyItems.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        No request history yet.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {historyItems.map((item) => {
                            const statusLabel = HISTORY_STATUS_LABELS[item.status] || item.status;
                            const statusStyle = HISTORY_STATUS_STYLES[item.status] || HISTORY_STATUS_STYLES.rejected;
                            const timelineKey = `${item.source}-${item.id}-${item.status}-${item.eventAt}`;
                            const user = item.user;
                            const connectionHeadline = item.source === 'connection' ? user?.headline : null;
                            const applicationProjectTitle =
                                item.source === 'application' ? item.project?.title || 'Unknown project' : null;
                            const applicationRoleTitle =
                                item.source === 'application' ? item.roleTitle || '—' : null;
                            const applicationProjectHref =
                                item.source === 'application'
                                    ? (item.project?.slug || item.project?.id ? `/projects/${item.project?.slug || item.project?.id}` : null)
                                    : null;

                            return (
                                <div
                                    key={timelineKey}
                                    className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                                >
                                    <div className="flex items-start gap-3">
                                        {user?.avatarUrl ? (
                                            <Image
                                                src={user.avatarUrl}
                                                alt={user.fullName || user.username || 'User'}
                                                width={40}
                                                height={40}
                                                className="h-10 w-10 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                                {item.source === 'application' ? (
                                                    <Briefcase className="h-4 w-4" />
                                                ) : (
                                                    <UserPlus className="h-4 w-4" />
                                                )}
                                            </div>
                                        )}

                                        <div className="min-w-0 flex-1">
                                            <div className="mb-1 flex items-center justify-between gap-2">
                                                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                    {item.source === 'application'
                                                        ? applicationProjectTitle
                                                        : user?.fullName || user?.username || 'Connection request'}
                                                </p>
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle}`}>
                                                    {statusLabel}
                                                </span>
                                            </div>
                                            <p className="text-sm text-zinc-600 dark:text-zinc-300">{getHistorySummary(item)}</p>
                                            {item.source === 'application' ? (
                                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{applicationRoleTitle}</p>
                                            ) : connectionHeadline ? (
                                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">{connectionHeadline}</p>
                                            ) : null}
                                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                                                {user ? (
                                                    <Link href={profileHref(user)} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                                                        View profile
                                                    </Link>
                                                ) : null}
                                                {item.source === 'application' && applicationProjectHref ? (
                                                    <Link
                                                        href={applicationProjectHref}
                                                        className="hover:text-indigo-600 dark:hover:text-indigo-400"
                                                    >
                                                        View project
                                                    </Link>
                                                ) : item.source === 'application' ? (
                                                    <span className="text-zinc-400 dark:text-zinc-500">Project unavailable</span>
                                                ) : null}
                                                {item.source === 'application' && item.conversationId ? (
                                                    <Link
                                                        href={`/messages?conversationId=${item.conversationId}&applicationId=${item.id}`}
                                                        className="hover:text-indigo-600 dark:hover:text-indigo-400"
                                                    >
                                                        Open chat
                                                    </Link>
                                                ) : null}
                                                <span>
                                                    {formatDistanceToNow(new Date(item.eventAt), { addSuffix: true })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
