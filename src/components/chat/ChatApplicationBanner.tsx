import { Clock, Check, X, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useChatStore } from "@/stores/chatStore";
import { acceptApplicationAction, rejectApplicationAction } from "@/app/actions/applications";
import { useState } from "react";
import Link from "next/link";

interface ChatApplicationBannerProps {
    isApplicant: boolean;
    isCreator: boolean;
    activeApplicationId: string;
    activeApplicationStatus: 'pending' | 'accepted' | 'rejected' | null;
    activeProjectId: string | null;
}

// Styles Configuration (Static)
const BANNER_STYLES = {
    accepted: {
        container: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900",
        iconBg: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400",
        title: "text-emerald-900 dark:text-emerald-100",
        text: "text-emerald-700 dark:text-emerald-300",
        Icon: Check
    },
    rejected: {
        container: "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900",
        iconBg: "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
        title: "text-red-900 dark:text-red-100",
        text: "text-red-700 dark:text-red-300",
        Icon: X
    },
    pending: {
        container: "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-900",
        iconBg: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400",
        title: "text-indigo-900 dark:text-indigo-100",
        text: "text-indigo-700 dark:text-indigo-300",
        Icon: Clock
    }
} as const;

export function ChatApplicationBanner({
    isApplicant,
    isCreator,
    activeApplicationId,
    activeApplicationStatus,
    activeProjectId
}: ChatApplicationBannerProps) {
    const [requestLoading, setRequestLoading] = useState(false);

    // Determine Logic State
    const status = activeApplicationStatus || 'pending';
    const isPending = status === 'pending';
    const isAccepted = status === 'accepted';
    const isRejected = status === 'rejected';

    const currentStyle = isAccepted ? BANNER_STYLES.accepted : isRejected ? BANNER_STYLES.rejected : BANNER_STYLES.pending;
    const { Icon } = currentStyle;

    // Content Handling
    const getTitle = () => {
        if (isAccepted) return isApplicant ? "Your application was accepted!" : "You accepted this application";
        if (isRejected) return isApplicant ? "Your application was rejected" : "You rejected this application";
        return isApplicant ? "Your application is pending" : "Role Application Received";
    };

    const getText = () => {
        if (isAccepted) return isApplicant ? "You can now collaborate on this project." : "Collaboration can begin.";
        if (isRejected) return isApplicant ? "This position has been filled or closed." : "Application closed.";
        return isApplicant ? "You can message the creator regarding your application." : "The applicant has messaged you. You can review and respond below.";
    };

    const handleAction = async (action: 'accept' | 'reject') => {
        // Optimistic UI Update
        const optimisticStatus = action === 'accept' ? 'accepted' : 'rejected';
        useChatStore.getState().setPartialStatus(optimisticStatus); // Need to implement this helper or just set state directly?
        // Actually we can set the store directly
        useChatStore.setState((state) => ({ activeApplicationStatus: optimisticStatus }));

        setRequestLoading(true);
        try {
            const fn = action === 'accept' ? acceptApplicationAction : rejectApplicationAction;
            const res = await fn(activeApplicationId);
            
            if (res.success) {
                toast.success(`Application ${action}ed!`);
                useChatStore.getState().checkActiveConnectionStatus(); // Sync final truth
            } else {
                toast.error(res.error || `Failed to ${action}`);
                // Rollback on error
                useChatStore.setState((state) => ({ activeApplicationStatus: 'pending' }));
            }
        } catch (e) {
            toast.error(`Error processing request`);
            useChatStore.setState((state) => ({ activeApplicationStatus: 'pending' }));
        } finally {
            setRequestLoading(false);
        }
    };

    return (
        <div className={`mx-3 mt-3 border rounded-lg p-3 flex items-center gap-3 ${currentStyle.container}`}>
            <div className={`p-2 rounded-full ${currentStyle.iconBg}`}>
                <Icon className="w-4 h-4" />
            </div>
            
            <div className="flex-1">
                <p className={`text-xs font-semibold ${currentStyle.title}`}>
                    {getTitle()}
                </p>
                <p className={`text-[10px] ${currentStyle.text}`}>
                    {getText()}
                </p>
            </div>

            {/* Actions: Only for Creator when Pending */}
            {isCreator && isPending && (
                <div className="flex gap-2">
                    <button
                        onClick={() => handleAction('accept')}
                        disabled={requestLoading}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                        {requestLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : "Accept"}
                    </button>
                    <button
                        onClick={() => handleAction('reject')}
                        disabled={requestLoading}
                        className="px-3 py-1.5 bg-transparent border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50"
                    >
                        Reject
                    </button>
                </div>
            )}

            {/* Project Workspace Button (Seamless Bridge) */}
            {isAccepted && activeProjectId && (
                <Link
                    href={`/projects/${activeProjectId}`}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-md hover:bg-emerald-700 transition-colors flex items-center gap-1"
                >
                    Open Dashboard
                    <ArrowRight className="w-3 h-3" />
                </Link>
            )}
        </div>
    );
}
