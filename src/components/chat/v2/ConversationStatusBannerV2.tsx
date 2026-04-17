'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { MessageWithSender } from '@/app/actions/messaging';
import type { ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import {
    acceptApplicationAction,
    editPendingApplicationAction,
    rejectApplicationAction,
    reopenApplicationAction,
    withdrawApplicationAction,
} from '@/app/actions/applications';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    hasLaterNonApplicationMessage,
    shouldHideTerminalApplicationBanner,
} from '@/lib/chat/banner-lifecycle';

type ApplicationBannerStatus = 'pending' | 'accepted' | 'rejected' | 'project_deleted';
type RequestAction = 'accept' | 'reject' | 'withdraw' | 'reopen';

interface ConversationStatusBannerV2Props {
    conversationId: string;
    capability: ConversationCapabilityV2 | null;
    messages: MessageWithSender[];
    surface?: 'page' | 'popup';
}

interface ApplicationEvent {
    applicationId: string | null;
    projectId: string | null;
    status: ApplicationBannerStatus;
    reasonCode: string | null;
    eventAtMs: number;
}

function hashText(input: string) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function extractApplicationBody(content: string | null) {
    const value = (content || '').trim();
    if (!value) return '';
    const blocks = value.split(/\n\s*\n/);
    if (blocks.length <= 1) return value;
    return blocks.slice(1).join('\n\n').trim();
}

function formatRelativeTimestamp(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

function toTimestamp(value: unknown): number | null {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    return null;
}

function readApplicationStatus(value: unknown): ApplicationBannerStatus | null {
    if (value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'project_deleted') {
        return value;
    }
    return null;
}

function readApplicationEvent(
    message: MessageWithSender,
    preferredApplicationId: string | null,
): ApplicationEvent | null {
    const metadata = (message.metadata || {}) as Record<string, unknown>;
    const isApplicationEvent = metadata.isApplication === true
        || metadata.isApplicationUpdate === true
        || metadata.kind === 'application'
        || metadata.kind === 'application_update';
    if (!isApplicationEvent) return null;

    const applicationId = typeof metadata.applicationId === 'string' ? metadata.applicationId : null;
    if (preferredApplicationId && applicationId && applicationId !== preferredApplicationId) {
        return null;
    }

    const status = readApplicationStatus(metadata.status);
    if (!status) return null;

    const eventAtMs = Math.max(
        toTimestamp(message.createdAt) ?? 0,
        toTimestamp(metadata.decisionAt) ?? 0,
        toTimestamp(metadata.reopenedAt) ?? 0,
    );

    return {
        applicationId,
        projectId: typeof metadata.projectId === 'string' ? metadata.projectId : null,
        status,
        reasonCode: typeof metadata.reasonCode === 'string' ? metadata.reasonCode : null,
        eventAtMs,
    };
}

function findLatestApplicationEvent(
    messages: MessageWithSender[],
    preferredApplicationId: string | null,
): ApplicationEvent | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const event = readApplicationEvent(messages[index], preferredApplicationId);
        if (event) return event;
    }

    if (preferredApplicationId) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const event = readApplicationEvent(messages[index], null);
            if (event) return event;
        }
    }

    return null;
}

export function ConversationStatusBannerV2({
    conversationId,
    capability,
    messages,
    surface = 'page',
}: ConversationStatusBannerV2Props) {
    const queryClient = useQueryClient();
    const [requestLoading, setRequestLoading] = useState<RequestAction | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isEditSaving, setIsEditSaving] = useState(false);
    const [editDraft, setEditDraft] = useState('');

    const banner = useMemo(() => {
        const preferredApplicationId = capability?.activeApplicationId ?? null;
        const latestEvent = findLatestApplicationEvent(messages, preferredApplicationId);
        const currentStatus = capability?.activeApplicationStatus ?? latestEvent?.status ?? null;
        const effectiveApplicationId = capability?.activeApplicationId ?? latestEvent?.applicationId ?? null;
        const deletedProjectBanner = {
            mode: 'passive' as const,
            tone: 'amber' as const,
            icon: AlertTriangle,
            title: 'Project deleted',
            description: 'This project was deleted, so this application thread is now read-only context.',
        };

        if (currentStatus === 'project_deleted') {
            return effectiveApplicationId
                && hasLaterNonApplicationMessage(messages, latestEvent?.eventAtMs ?? 0, effectiveApplicationId)
                ? null
                : deletedProjectBanner;
        }

        if (!currentStatus || !effectiveApplicationId) {
            return latestEvent && latestEvent.status === 'project_deleted'
                ? deletedProjectBanner
                : null;
        }

        if ((currentStatus === 'accepted' || currentStatus === 'rejected') && shouldHideTerminalApplicationBanner({
            status: currentStatus,
            applicationId: effectiveApplicationId,
            messages,
        })) {
            return null;
        }

        let applicationMetadata: Record<string, unknown> | null = null;
        let cachedApplicationDraft = '';
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const item = messages[index];
            const metadata = (item.metadata || {}) as Record<string, unknown>;
            if (metadata.applicationId !== effectiveApplicationId) continue;
            if (metadata.isApplication === true || metadata.isApplicationUpdate === true || metadata.kind === 'application' || metadata.kind === 'application_update') {
                applicationMetadata = metadata;
                if (!cachedApplicationDraft && metadata.isApplication === true) {
                    cachedApplicationDraft = extractApplicationBody(item.content);
                }
                if (metadata.isApplication === true && cachedApplicationDraft) break;
            }
        }

        const reasonCode = typeof applicationMetadata?.reasonCode === 'string'
            ? applicationMetadata.reasonCode
            : latestEvent?.reasonCode ?? null;
        const decisionAt = typeof applicationMetadata?.decisionAt === 'string' ? applicationMetadata.decisionAt : null;
        const reopenedAt = typeof applicationMetadata?.reopenedAt === 'string' ? applicationMetadata.reopenedAt : null;
        const lastStatusUpdate = formatRelativeTimestamp(reopenedAt || decisionAt);
        const activeProjectId = capability?.activeProjectId ?? latestEvent?.projectId ?? null;

        return {
            mode: 'workflow' as const,
            applicationId: effectiveApplicationId,
            status: currentStatus,
            reasonCode,
            activeProjectId,
            lastStatusUpdate,
            cachedApplicationDraft,
        };
    }, [capability, messages]);

    const handleAction = async (action: RequestAction) => {
        if (!banner || banner.mode !== 'workflow') return;
        setRequestLoading(action);
        try {
            const idempotencyKey = `chat-v2:${action}:${banner.applicationId}`;
            const result = action === 'accept'
                ? await acceptApplicationAction(banner.applicationId, undefined, { idempotencyKey })
                : action === 'reject'
                    ? await rejectApplicationAction(banner.applicationId, undefined, 'other', { idempotencyKey })
                    : action === 'withdraw'
                        ? await withdrawApplicationAction(banner.applicationId, undefined, { idempotencyKey })
                        : await reopenApplicationAction(banner.applicationId, undefined, { idempotencyKey });

            if (!result.success) {
                toast.error(result.error || `Failed to ${action}`);
                return;
            }
            toast.success(
                action === 'withdraw'
                    ? 'Application withdrawn'
                    : action === 'reopen'
                        ? 'Application reopened'
                        : `Application ${action}ed`,
            );
            await refreshConversationCache(queryClient, conversationId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update application');
        } finally {
            setRequestLoading(null);
        }
    };

    const handleEditOpen = () => {
        if (!banner || banner.mode !== 'workflow') return;
        setEditDraft(banner.cachedApplicationDraft);
        setIsEditOpen(true);
    };

    const handleEditSubmit = async () => {
        if (!banner || banner.mode !== 'workflow') return;
        const nextMessage = editDraft.trim();
        if (!nextMessage) {
            toast.error('Application message cannot be empty');
            return;
        }

        setIsEditSaving(true);
        try {
            const idempotencyKey = `chat-v2:edit:${banner.applicationId}:${hashText(nextMessage)}`;
            const result = await editPendingApplicationAction(banner.applicationId, nextMessage, { idempotencyKey });
            if (!result.success) {
                toast.error(result.error || 'Failed to edit application');
                return;
            }
            toast.success('Application updated');
            setIsEditOpen(false);
            await refreshConversationCache(queryClient, conversationId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to edit application');
        } finally {
            setIsEditSaving(false);
        }
    };

    if (!banner) return null;

    if (banner.mode === 'passive') {
        return (
            <div className={`border-b border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100 ${
                surface === 'popup' ? 'px-3 py-2.5' : 'px-5 py-3.5'
            }`}>
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-white/70 p-1.5 dark:bg-black/10">
                        <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <div className={`font-semibold ${surface === 'popup' ? 'text-[13px]' : 'text-sm'}`}>Project deleted</div>
                        <div className="mt-1 text-xs opacity-80">
                            This project was deleted, so this application thread is now read-only context.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const status = banner.status;
    const isApplicant = capability?.isApplicant === true;
    const isCreator = capability?.isCreator === true;
    const isPending = status === 'pending';
    const isAccepted = status === 'accepted';
    const isRejected = status === 'rejected';
    const currentStyle = isAccepted
        ? {
            container: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30',
            iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
            title: 'text-emerald-900 dark:text-emerald-100',
            text: 'text-emerald-700 dark:text-emerald-300',
            Icon: CheckCircle2,
        }
        : isRejected
            ? {
                container: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30',
                iconBg: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
                title: 'text-red-900 dark:text-red-100',
                text: 'text-red-700 dark:text-red-300',
                Icon: XCircle,
            }
            : {
                container: 'border-indigo-200 bg-indigo-50 dark:border-indigo-900/50 dark:bg-indigo-950/30',
                iconBg: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
                title: 'text-indigo-900 dark:text-indigo-100',
                text: 'text-indigo-700 dark:text-indigo-300',
                Icon: Clock3,
            };
    const { Icon } = currentStyle;

    const title = isAccepted
        ? isApplicant ? 'Your application was accepted!' : 'You accepted this application'
        : isRejected
            ? isApplicant ? 'Your application was rejected' : 'You rejected this application'
            : isApplicant
                ? 'Your application is pending'
                : 'Role application received';
    const text = isAccepted
        ? 'Now collaborating on this project.'
        : isRejected && banner.reasonCode === 'role_filled'
            ? 'Role was filled.'
            : isRejected && banner.reasonCode === 'withdrawn_by_applicant'
                ? 'Application withdrawn.'
                : isRejected
                    ? 'Application closed.'
                    : isApplicant
                        ? 'Pending review. You can edit or withdraw.'
                        : 'Pending review. Accept or reject.';

    return (
        <>
            <div className={`border-b ${currentStyle.container} ${surface === 'popup' ? 'px-3 py-2.5' : 'px-5 py-3.5'}`}>
                <div className="flex items-start gap-3">
                    <div className={`mt-0.5 rounded-full p-1.5 ${currentStyle.iconBg}`}>
                        <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className={`truncate font-semibold ${currentStyle.title} ${surface === 'popup' ? 'text-[13px]' : 'text-sm'}`}>{title}</div>
                        <div className={`mt-1 text-xs ${currentStyle.text}`}>{text}</div>
                    </div>
                    {banner.lastStatusUpdate ? (
                        <div className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                            {banner.lastStatusUpdate}
                        </div>
                    ) : null}
                </div>

                <div className={`mt-3 flex flex-wrap items-center gap-1.5 ${surface === 'popup' ? 'justify-start' : 'justify-end'}`}>
                    {isCreator && isPending ? (
                        <>
                            <button
                                onClick={() => void handleAction('accept')}
                                disabled={requestLoading !== null}
                                className={`flex items-center gap-1 rounded-md bg-indigo-600 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 ${
                                    surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                                }`}
                            >
                                {requestLoading === 'accept' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Accept'}
                            </button>
                            <button
                                onClick={() => void handleAction('reject')}
                                disabled={requestLoading !== null}
                                className={`flex items-center gap-1 rounded-md border border-indigo-200 font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/40 ${
                                    surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                                }`}
                            >
                                {requestLoading === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reject'}
                            </button>
                        </>
                    ) : null}

                    {isApplicant && isPending ? (
                        <>
                            <button
                                onClick={handleEditOpen}
                                disabled={requestLoading !== null || isEditSaving}
                                className={`rounded-md border border-indigo-200 font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/40 ${
                                    surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                                }`}
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => void handleAction('withdraw')}
                                disabled={requestLoading !== null || isEditSaving}
                                className={`flex items-center gap-1 rounded-md border border-zinc-300 font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 ${
                                    surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                                }`}
                            >
                                {requestLoading === 'withdraw' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Withdraw'}
                            </button>
                        </>
                    ) : null}

                    {isCreator && isRejected ? (
                        <button
                            onClick={() => void handleAction('reopen')}
                            disabled={requestLoading !== null}
                            className={`flex items-center gap-1 rounded-md border border-indigo-200 font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/40 ${
                                surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                            }`}
                        >
                            {requestLoading === 'reopen' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reopen'}
                        </button>
                    ) : null}

                    {isAccepted && banner.activeProjectId ? (
                        <Link
                            href={`/projects/${banner.activeProjectId}`}
                            className={`inline-flex items-center gap-1 rounded-md bg-emerald-600 font-semibold text-white transition-colors hover:bg-emerald-700 ${
                                surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                            }`}
                        >
                            Open
                            <ArrowRight className="h-3 w-3" />
                        </Link>
                    ) : null}

                    <Link
                        href={`/people?tab=requests#app-${banner.applicationId}`}
                        className={`inline-flex items-center rounded-md border border-zinc-200 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                            surface === 'popup' ? 'h-7 px-2 text-[10px]' : 'h-7 px-2.5 text-[10px]'
                        }`}
                    >
                        View request
                    </Link>
                </div>
            </div>

            <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit application</DialogTitle>
                        <DialogDescription>
                            Keep it concise. Changes are synced into this chat thread.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        rows={8}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-primary dark:border-zinc-800 dark:bg-zinc-900"
                    />
                    <DialogFooter>
                        <button
                            type="button"
                            onClick={() => setIsEditOpen(false)}
                            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleEditSubmit()}
                            disabled={isEditSaving}
                            className="rounded-lg app-accent-solid px-3 py-2 text-sm disabled:opacity-60"
                        >
                            {isEditSaving ? 'Saving…' : 'Save changes'}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
