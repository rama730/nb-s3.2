import { Clock, Check, X, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useChatStore } from "@/stores/chatStore";
import {
    acceptApplicationAction,
    rejectApplicationAction,
    withdrawApplicationAction,
    editPendingApplicationAction,
    reopenApplicationAction,
} from "@/app/actions/applications";
import type { MessageWithSender } from "@/app/actions/messaging";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { PROJECT_MEMBERS_QUERY_KEY } from "@/hooks/hub/useProjectData";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { shouldHideTerminalApplicationBanner } from "@/lib/chat/banner-lifecycle";

interface ChatApplicationBannerProps {
    isApplicant: boolean;
    isCreator: boolean;
    activeApplicationId: string;
    activeApplicationStatus: 'pending' | 'accepted' | 'rejected' | null;
    activeProjectId: string | null;
    conversationId: string;
}
type RequestAction = 'accept' | 'reject' | 'withdraw' | 'reopen';

const EMPTY_MESSAGES: ReadonlyArray<MessageWithSender> = [];

function extractApplicationBody(content: string | null) {
    const value = (content || "").trim();
    if (!value) return "";
    const blocks = value.split(/\n\s*\n/);
    if (blocks.length <= 1) return value;
    return blocks.slice(1).join("\n\n").trim();
}

function formatRelativeTimestamp(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const diffMs = date.getTime() - Date.now();
    const absDiffMs = Math.abs(diffMs);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;
    const MONTH = 30 * DAY;
    const YEAR = 365 * DAY;

    if (absDiffMs < MINUTE) {
        return rtf.format(Math.round(diffMs / SECOND), "second");
    }
    if (absDiffMs < HOUR) {
        return rtf.format(Math.round(diffMs / MINUTE), "minute");
    }
    if (absDiffMs < DAY) {
        return rtf.format(Math.round(diffMs / HOUR), "hour");
    }
    if (absDiffMs < WEEK) {
        return rtf.format(Math.round(diffMs / DAY), "day");
    }
    if (absDiffMs < MONTH) {
        return rtf.format(Math.round(diffMs / WEEK), "week");
    }
    if (absDiffMs < YEAR) {
        return rtf.format(Math.round(diffMs / MONTH), "month");
    }
    return rtf.format(Math.round(diffMs / YEAR), "year");
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
    activeProjectId,
    conversationId,
}: ChatApplicationBannerProps) {
    const [requestLoading, setRequestLoading] = useState<RequestAction | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isEditSaving, setIsEditSaving] = useState(false);
    const [editDraft, setEditDraft] = useState("");
    const queryClient = useQueryClient();
    const refreshMessages = useChatStore(state => state.refreshMessages);
    const checkActiveConnectionStatus = useChatStore(state => state.checkActiveConnectionStatus);
    const fetchApplications = useChatStore(state => state.fetchApplications);
    const conversationMessages = useChatStore(
        state => state.messagesByConversation[conversationId]?.messages || EMPTY_MESSAGES
    );

    // Determine Logic State
    const status = activeApplicationStatus || 'pending';
    const isPending = status === 'pending';
    const isAccepted = status === 'accepted';
    const isRejected = status === 'rejected';
    const shouldHideBanner = useMemo(
        () =>
            shouldHideTerminalApplicationBanner({
                status,
                applicationId: activeApplicationId,
                messages: conversationMessages,
            }),
        [activeApplicationId, conversationMessages, status]
    );

    const currentStyle = isAccepted ? BANNER_STYLES.accepted : isRejected ? BANNER_STYLES.rejected : BANNER_STYLES.pending;
    const { Icon } = currentStyle;
    const cachedApplicationDraft = useMemo(() => {
        for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
            const item = conversationMessages[index];
            const metadata = item.metadata || {};
            if (metadata.isApplication === true && metadata.applicationId === activeApplicationId) {
                return extractApplicationBody(item.content);
            }
        }
        return "";
    }, [activeApplicationId, conversationMessages]);
    const applicationMetadata = useMemo(() => {
        for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
            const item = conversationMessages[index];
            const metadata = item.metadata || {};
            if (metadata.isApplication === true && metadata.applicationId === activeApplicationId) {
                return metadata;
            }
        }
        return null;
    }, [activeApplicationId, conversationMessages]);
    const reasonCode = typeof applicationMetadata?.reasonCode === "string" ? applicationMetadata.reasonCode : null;
    const decisionAt = typeof applicationMetadata?.decisionAt === "string" ? applicationMetadata.decisionAt : null;
    const reopenedAt = typeof applicationMetadata?.reopenedAt === "string" ? applicationMetadata.reopenedAt : null;
    const lastStatusUpdate = formatRelativeTimestamp(reopenedAt || decisionAt);

    if (shouldHideBanner) {
        return null;
    }

    // Content Handling
    const getTitle = () => {
        if (isAccepted) return isApplicant ? "Your application was accepted!" : "You accepted this application";
        if (isRejected) return isApplicant ? "Your application was rejected" : "You rejected this application";
        return isApplicant ? "Your application is pending" : "Role Application Received";
    };

    const getText = () => {
        if (isAccepted) return "Now collaborating on this project.";
        if (isRejected && reasonCode === "role_filled") return "Role was filled.";
        if (isRejected && reasonCode === "withdrawn_by_applicant") return "Application withdrawn.";
        if (isRejected) return "Application closed.";
        return isApplicant ? "Pending review. You can edit or withdraw." : "Pending review. Accept or reject.";
    };

    const handleAction = async (action: RequestAction) => {
        const previousStatus = activeApplicationStatus || 'pending';
        // Optimistic UI Update
        const optimisticStatus = action === 'accept' ? 'accepted' : action === 'reopen' ? 'pending' : 'rejected';
        useChatStore.getState().setPartialStatus(optimisticStatus);

        setRequestLoading(action);
        try {
            const fn = action === 'accept'
                ? acceptApplicationAction
                : action === 'reject'
                    ? rejectApplicationAction
                    : action === 'withdraw'
                        ? withdrawApplicationAction
                        : reopenApplicationAction;
            const res = await fn(activeApplicationId);
            
            if (res.success) {
                const successText =
                    action === 'withdraw'
                        ? 'Application withdrawn'
                        : action === 'reopen'
                            ? 'Application reopened'
                            : `Application ${action}ed!`;
                toast.success(successText);
                if (activeProjectId) {
                    await queryClient.invalidateQueries({
                        queryKey: PROJECT_MEMBERS_QUERY_KEY(activeProjectId),
                        refetchType: "all",
                    });
                }
                const refreshMessagesPromise =
                    conversationId !== "new" ? refreshMessages(conversationId) : Promise.resolve();
                await Promise.all([
                    refreshMessagesPromise,
                    fetchApplications(true),
                    checkActiveConnectionStatus(),
                ]);
            } else {
                toast.error(res.error || `Failed to ${action}`);
                // Rollback on error
                useChatStore.setState({ activeApplicationStatus: previousStatus });
            }
        } catch {
            toast.error(`Error processing request`);
            useChatStore.setState({ activeApplicationStatus: previousStatus });
        } finally {
            setRequestLoading(null);
        }
    };

    const handleEditOpen = () => {
        setEditDraft(cachedApplicationDraft);
        setIsEditOpen(true);
    };

    const handleEditSubmit = async () => {
        const nextMessage = editDraft.trim();
        if (!nextMessage) {
            toast.error("Application message cannot be empty");
            return;
        }

        setIsEditSaving(true);
        try {
            const result = await editPendingApplicationAction(activeApplicationId, nextMessage);
            if (!result.success) {
                toast.error(result.error || "Failed to edit application");
                return;
            }

            toast.success("Application updated");
            setIsEditOpen(false);

            if (activeProjectId) {
                await queryClient.invalidateQueries({
                    queryKey: PROJECT_MEMBERS_QUERY_KEY(activeProjectId),
                    refetchType: "all",
                });
            }
            const refreshMessagesPromise =
                conversationId !== "new" ? refreshMessages(conversationId) : Promise.resolve();

            await Promise.all([
                refreshMessagesPromise,
                fetchApplications(true),
                checkActiveConnectionStatus(),
            ]);
        } catch {
            toast.error("Failed to edit application");
        } finally {
            setIsEditSaving(false);
        }
    };

    return (
        <>
            <div className={`mx-3 mt-2 border rounded-md px-2.5 py-2 ${currentStyle.container}`}>
                <div className="flex items-start gap-2">
                    <div className={`mt-0.5 p-1.5 rounded-full ${currentStyle.iconBg}`}>
                        <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className={`text-[11px] font-semibold leading-4 truncate ${currentStyle.title}`}>
                            {getTitle()}
                        </p>
                        <p className={`text-[10px] leading-4 truncate ${currentStyle.text}`}>
                            {getText()}
                        </p>
                    </div>
                    {lastStatusUpdate ? (
                        <p className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                            {lastStatusUpdate}
                        </p>
                    ) : null}
                </div>

                <div className="mt-2 flex items-center justify-end gap-1.5 flex-wrap">
                    {isCreator && isPending && (
                        <>
                            <button
                                onClick={() => handleAction('accept')}
                                disabled={requestLoading !== null}
                                className="h-6 px-2.5 bg-indigo-600 text-white text-[10px] font-semibold rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                                {requestLoading === 'accept' ? <Loader2 className="w-3 h-3 animate-spin"/> : "Accept"}
                            </button>
                            <button
                                onClick={() => handleAction('reject')}
                                disabled={requestLoading !== null}
                                className="h-6 px-2.5 bg-transparent border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                                {requestLoading === 'reject' ? <Loader2 className="w-3 h-3 animate-spin"/> : "Reject"}
                            </button>
                        </>
                    )}

                    {isApplicant && isPending && (
                        <>
                            <button
                                onClick={handleEditOpen}
                                disabled={requestLoading !== null || isEditSaving}
                                className="h-6 px-2.5 bg-transparent border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50"
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => handleAction('withdraw')}
                                disabled={requestLoading !== null || isEditSaving}
                                className="h-6 px-2.5 bg-transparent border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-[10px] font-semibold rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                                {requestLoading === 'withdraw' ? <Loader2 className="w-3 h-3 animate-spin"/> : "Withdraw"}
                            </button>
                        </>
                    )}

                    {isCreator && isRejected && (
                        <button
                            onClick={() => handleAction('reopen')}
                            disabled={requestLoading !== null}
                            className="h-6 px-2.5 bg-transparent border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            {requestLoading === 'reopen' ? <Loader2 className="w-3 h-3 animate-spin"/> : "Reopen"}
                        </button>
                    )}

                    {isAccepted && activeProjectId && (
                        <Link
                            href={`/projects/${activeProjectId}`}
                            className="h-6 px-2.5 bg-emerald-600 text-white text-[10px] font-semibold rounded-md hover:bg-emerald-700 transition-colors flex items-center gap-1"
                        >
                            Open
                            <ArrowRight className="w-3 h-3" />
                        </Link>
                    )}
                    <Link
                        href={`/people?tab=requests#app-${activeApplicationId}`}
                        className="h-6 px-2.5 inline-flex items-center text-[10px] font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        View request
                    </Link>
                </div>
            </div>

            <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Application</DialogTitle>
                        <DialogDescription>
                            Keep it concise. Changes are synced into this chat thread.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value.slice(0, 2000))}
                        rows={8}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
                        placeholder="Write your updated application message..."
                        disabled={isEditSaving}
                        aria-label="Edit application message"
                    />
                    <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                        {editDraft.length}/2000
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            type="button"
                            onClick={() => setIsEditOpen(false)}
                            disabled={isEditSaving}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleEditSubmit}
                            disabled={isEditSaving || !editDraft.trim()}
                        >
                            {isEditSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
