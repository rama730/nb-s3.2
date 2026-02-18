import { useMemo, useState } from "react";
import { Loader2, UserPlus, X, Check, Clock, CheckCheck, Briefcase, ChevronDown, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatDistanceToNow, isToday, isYesterday, subDays, isAfter } from "date-fns";
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
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import ProjectApplicationsSection from "./ProjectApplicationsSection";
import type { IncomingApplication, MyApplication } from "./ProjectApplicationsSection";
import type {
    ApplicationLifecycleStatus,
    ConnectionRequestHistoryStatus,
} from "@/lib/applications/status";

interface RequestsTabProps {
    initialUser: { id?: string | null } | null;
    initialRequests?: { incoming: PendingIncomingRequest[]; sent: PendingSentRequest[] };
    initialApplications?: { my: MyApplication[]; incoming: IncomingApplication[] };
}

type HistoryStatus = ApplicationLifecycleStatus | ConnectionRequestHistoryStatus;

const HISTORY_STATUS_STYLES: Record<HistoryStatus, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    rejected: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    cancelled: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    disconnected: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    withdrawn: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    role_filled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    disconnected: 'Disconnected',
    withdrawn: 'Withdrawn',
    role_filled: 'Role Filled',
};

const TIMELINE_DOT_COLORS: Record<string, string> = {
    accepted: 'bg-emerald-500',
    rejected: 'bg-zinc-400 dark:bg-zinc-600',
    cancelled: 'bg-zinc-400 dark:bg-zinc-600',
    pending: 'bg-amber-500',
    disconnected: 'bg-zinc-400 dark:bg-zinc-600',
    withdrawn: 'bg-zinc-400 dark:bg-zinc-600',
    role_filled: 'bg-blue-500',
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
    if ((item.status as string) === 'cancelled') {
        return 'Application was cancelled';
    }

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

function groupHistoryByTime(items: RequestHistoryItem[]): { label: string; items: RequestHistoryItem[] }[] {
    const groups: { label: string; items: RequestHistoryItem[] }[] = [];
    const today: RequestHistoryItem[] = [];
    const yesterday: RequestHistoryItem[] = [];
    const lastWeek: RequestHistoryItem[] = [];
    const older: RequestHistoryItem[] = [];

    const weekAgo = subDays(new Date(), 7);

    for (const item of items) {
        const date = new Date(item.eventAt);
        if (isToday(date)) {
            today.push(item);
        } else if (isYesterday(date)) {
            yesterday.push(item);
        } else if (isAfter(date, weekAgo)) {
            lastWeek.push(item);
        } else {
            older.push(item);
        }
    }

    if (today.length > 0) groups.push({ label: 'Today', items: today });
    if (yesterday.length > 0) groups.push({ label: 'Yesterday', items: yesterday });
    if (lastWeek.length > 0) groups.push({ label: 'This Week', items: lastWeek });
    if (older.length > 0) groups.push({ label: 'Earlier', items: older });

    return groups;
}

export default function RequestsTab({ initialUser, initialRequests, initialApplications }: RequestsTabProps) {
    const { data: requestData, isLoading: requestsLoading } = usePendingRequests();
    const { data: requestHistoryData, isLoading: historyLoading } = useRequestHistory(80);
    const { acceptRequest, rejectRequest, undoRejectRequest, cancelRequest, acceptAllIncoming, rejectAllIncoming } = useConnectionMutations();

    const [timelineOpen, setTimelineOpen] = useState(true);
    const [appsOpen, setAppsOpen] = useState(true);

    const incomingRequests = useMemo(
        () => requestData?.incoming || initialRequests?.incoming || [],
        [requestData?.incoming, initialRequests?.incoming],
    );
    const sentRequests = useMemo(
        () => requestData?.sent || initialRequests?.sent || [],
        [requestData?.sent, initialRequests?.sent],
    );

    const isLoading = requestsLoading && !initialRequests && incomingRequests.length === 0 && sentRequests.length === 0;
    const historyItems = useMemo(
        () => requestHistoryData?.items ?? [],
        [requestHistoryData?.items],
    );
    const groupedHistory = useMemo(() => groupHistoryByTime(historyItems), [historyItems]);

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

    if (isLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="flex gap-4">
                    <div className="flex-1 h-24 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                    <div className="flex-1 h-24 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />
                </div>
                <div className="flex gap-6">
                    <div className="flex-1 space-y-3">
                        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />)}
                    </div>
                    <div className="flex-1 space-y-3">
                        {[1, 2].map(i => <div key={i} className="h-20 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl" />)}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* ── SUMMARY CARDS ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Incoming summary */}
                <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                <UserPlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Incoming</h3>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">connection requests</p>
                            </div>
                        </div>
                        <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            {incomingRequests.length}
                        </span>
                    </div>
                    {incomingRequests.length > 1 && (
                        <div className="flex gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                type="button"
                                onClick={handleAcceptAll}
                                disabled={acceptAllIncoming.isPending || rejectAllIncoming.isPending}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300/60 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300 transition-colors disabled:opacity-50"
                            >
                                <CheckCheck className="w-3.5 h-3.5" />
                                Accept all
                            </button>
                            <button
                                type="button"
                                onClick={handleRejectAll}
                                disabled={acceptAllIncoming.isPending || rejectAllIncoming.isPending}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300/60 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-500/20 dark:text-red-300 transition-colors disabled:opacity-50"
                            >
                                <X className="w-3.5 h-3.5" />
                                Reject all
                            </button>
                        </div>
                    )}
                </div>

                {/* Sent summary */}
                <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
                                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sent</h3>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">pending requests</p>
                            </div>
                        </div>
                        <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            {sentRequests.length}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── DUAL-COLUMN REQUESTS ── */}
            {(incomingRequests.length > 0 || sentRequests.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* LEFT: Incoming */}
                    <div>
                        {incomingRequests.length > 0 && (
                            <>
                                <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <UserPlus className="w-4 h-4 text-indigo-500" />
                                    Incoming Requests
                                </h2>
                                <div className="space-y-3">
                                    {incomingRequests.map((req) => {
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
                                            <motion.div
                                                key={req.id}
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-4 hover:shadow-lg transition-all"
                                            >
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
                                                            className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 block truncate transition-colors"
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
                                                        className="flex-1 px-3 py-2 text-sm rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
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
                                                        className="px-3 py-2 text-sm rounded-xl border border-zinc-200/60 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                                                    >
                                                        {rejectRequest.isPending && rejectRequest.variables === req.id ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            <X className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        {incomingRequests.length === 0 && (
                            <div className="text-center py-12 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5">
                                <UserPlus className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">No incoming requests</p>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Sent */}
                    <div>
                        {sentRequests.length > 0 && (
                            <>
                                <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-amber-500" />
                                    Sent Requests
                                </h2>
                                <div className="space-y-3">
                                    {sentRequests.map((req) => {
                                        const profile = {
                                            id: req.addresseeId,
                                            username: req.addresseeUsername,
                                            fullName: req.addresseeFullName,
                                            avatarUrl: req.addresseeAvatarUrl,
                                            headline: req.addresseeHeadline,
                                        };
                                        const isProcessing = cancelRequest.isPending && cancelRequest.variables === req.id;

                                        return (
                                            <motion.div
                                                key={req.id}
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-4 hover:shadow-lg transition-all"
                                            >
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
                                                            className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 block truncate transition-colors"
                                                        >
                                                            {profile.fullName || profile.username || "User"}
                                                        </Link>
                                                        {profile.headline && (
                                                            <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1">
                                                                {profile.headline}
                                                            </p>
                                                        )}
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">
                                                                <Clock className="w-3 h-3" />
                                                                Pending
                                                            </span>
                                                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                                                Sent {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-4">
                                                    <button
                                                        onClick={() => handleCancel(req.id)}
                                                        disabled={isProcessing}
                                                        className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200/60 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                                                    >
                                                        {isProcessing ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            <X className="w-4 h-4" />
                                                        )}
                                                        Cancel Request
                                                    </button>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        {sentRequests.length === 0 && (
                            <div className="text-center py-12 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5">
                                <Clock className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">No sent requests</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Empty state when no requests at all */}
            {incomingRequests.length === 0 && sentRequests.length === 0 && (
                <div className="text-center py-16 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5">
                    <UserPlus className="w-14 h-14 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-600 dark:text-zinc-400 text-lg font-medium">No pending connection requests</p>
                    <Link href="/people?tab=discover" className="text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block text-sm">
                        Discover people to connect with
                    </Link>
                </div>
            )}

            {/* ── PROJECT APPLICATIONS (Collapsible) ── */}
            <div>
                <button
                    type="button"
                    onClick={() => setAppsOpen(!appsOpen)}
                    className="flex items-center gap-2 mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                    {appsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <Briefcase className="w-4 h-4" />
                    Project Applications
                </button>
                <AnimatePresence initial={false}>
                    {appsOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <ProjectApplicationsSection initialUser={initialUser} initialApplications={initialApplications} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── ACTIVITY TIMELINE (Collapsible) ── */}
            <div>
                <button
                    type="button"
                    onClick={() => setTimelineOpen(!timelineOpen)}
                    className="flex items-center gap-2 mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                    {timelineOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <Clock className="w-4 h-4" />
                    Activity Timeline
                </button>
                <AnimatePresence initial={false}>
                    {timelineOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            {historyLoading && historyItems.length === 0 ? (
                                <div className="flex items-center justify-center rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                                </div>
                            ) : groupedHistory.length === 0 ? (
                                <div className="rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                    No activity yet.
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {groupedHistory.map((group) => (
                                        <div key={group.label}>
                                            {/* Time period header */}
                                            <div className="flex items-center gap-2 mb-3">
                                                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{group.label}</span>
                                                <div className="flex-1 h-px bg-zinc-200/60 dark:bg-zinc-800" />
                                            </div>
                                            {/* Timeline items */}
                                            <div className="relative pl-6">
                                                {/* Vertical timeline line */}
                                                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-gradient-to-b from-zinc-300 via-zinc-200 to-transparent dark:from-zinc-600 dark:via-zinc-700 dark:to-transparent" />

                                                <div className="space-y-3">
                                                    {group.items.map((item) => {
                                                        const timelineKey = `${item.source}-${item.id}-${item.status}-${item.eventAt}`;
                                                        const dotColor = TIMELINE_DOT_COLORS[item.status] || 'bg-zinc-400';
                                                        const user = item.user;

                                                        return (
                                                            <div key={timelineKey} className="relative flex items-start gap-3">
                                                                {/* Timeline dot */}
                                                                <div className={cn("absolute -left-6 top-2 w-[10px] h-[10px] rounded-full ring-2 ring-zinc-50 dark:ring-zinc-900", dotColor)} />

                                                                <div className="flex-1 rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl p-3">
                                                                    <div className="flex items-start gap-3">
                                                                        {user?.avatarUrl ? (
                                                                            <Image
                                                                                src={user.avatarUrl}
                                                                                alt={user.fullName || user.username || 'User'}
                                                                                width={32}
                                                                                height={32}
                                                                                className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                                                                            />
                                                                        ) : (
                                                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 flex-shrink-0">
                                                                                {item.source === 'application' ? (
                                                                                    <Briefcase className="h-3.5 w-3.5" />
                                                                                ) : (
                                                                                    <UserPlus className="h-3.5 w-3.5" />
                                                                                )}
                                                                            </div>
                                                                        )}

                                                                        <div className="min-w-0 flex-1">
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                                                    {item.source === 'application'
                                                                                        ? item.project?.title || 'Unknown project'
                                                                                        : user?.fullName || user?.username || 'User'}
                                                                                </p>
                                                                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0", HISTORY_STATUS_STYLES[item.status as HistoryStatus] || HISTORY_STATUS_STYLES.rejected)}>
                                                                                    {HISTORY_STATUS_LABELS[item.status as HistoryStatus] || item.status}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{getHistorySummary(item)}</p>
                                                                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                                                                                {user && (
                                                                                    <Link href={profileHref(user)} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                                                                        View profile
                                                                                    </Link>
                                                                                )}
                                                                                {item.source === 'application' && item.project?.slug && (
                                                                                    <Link href={`/projects/${item.project.slug}`} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                                                                        View project
                                                                                    </Link>
                                                                                )}
                                                                                <span>{formatDistanceToNow(new Date(item.eventAt), { addSuffix: true })}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
