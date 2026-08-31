'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Loader2, XCircle, ArrowRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { MessageWithSender } from '@/app/actions/messaging';
import {
    acceptApplicationAction,
    editPendingApplicationAction,
    rejectApplicationAction,
    reopenApplicationAction,
    withdrawApplicationAction,
    acceptProposedRoleAction,
    declineProposedRoleAction,
} from '@/app/actions/applications';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { useConversationThread, useMessagesActions } from '@/hooks/useMessagesV2';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    findLatestApplicationEvent,
    extractApplicationBody,
    hashText,
} from '@/lib/chat/application-events';
import { formatDistanceToNow } from 'date-fns';
import { getStructuredMessageFromMetadata } from '@/lib/messages/structured';
import { useAuth } from '@/hooks/useAuth';

type RequestAction = 'accept' | 'reject' | 'withdraw' | 'reopen' | 'accept_proposed' | 'decline_proposed';

interface ApplicationSystemCardV2Props {
    message: MessageWithSender;
    conversationId: string;
}

export function ApplicationSystemCardV2({
    message,
    conversationId,
}: ApplicationSystemCardV2Props) {
    const { messages, capability } = useConversationThread(conversationId);
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const { resolveWorkflow } = useMessagesActions();
    const [requestLoading, setRequestLoading] = useState<RequestAction | null>(null);
    const [workflowActionLoading, setWorkflowActionLoading] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isEditSaving, setIsEditSaving] = useState(false);
    
    const metadata = useMemo(
        () => (message.metadata || {}) as Record<string, unknown>,
        [message.metadata]
    );
    const structured = useMemo(() => getStructuredMessageFromMetadata(metadata), [metadata]);
    const isInvite = structured?.kind === 'project_invite';
    const isAssignee = structured?.entityRefs?.profileId === user?.id;

    const baseApplicationId = typeof metadata.applicationId === 'string' ? metadata.applicationId : null;
    const workflowItemId = structured?.workflowItemId || null;

    const payload = (structured?.payload || {}) as Record<string, unknown>;
    const roleTitle = isInvite
        ? (typeof payload.roleTitle === 'string' ? payload.roleTitle : 'a role')
        : (typeof metadata.roleTitle === 'string' ? metadata.roleTitle : 'a role');
    const projectTitle = isInvite
        ? (typeof payload.projectTitle === 'string' ? payload.projectTitle : 'Unknown Project')
        : (typeof metadata.projectTitle === 'string' ? metadata.projectTitle : 'Unknown Project');

    const initialContent = isInvite
        ? (typeof payload.note === 'string' ? payload.note : '')
        : extractApplicationBody(message.content);
    const [editDraft, setEditDraft] = useState(initialContent);

    const banner = useMemo(() => {
        if (!baseApplicationId && !workflowItemId) return null;
        
        if (isInvite) {
            const currentStatus = structured?.stateSnapshot?.status ?? 'pending';
            const decisionAt = structured?.stateSnapshot?.resolvedAt ?? null;
            const lastStatusUpdate = decisionAt ? formatDistanceToNow(new Date(decisionAt), { addSuffix: true }) : null;
            const activeProjectId = structured?.entityRefs?.projectId ?? null;
            
            return {
                mode: 'workflow' as const,
                status: currentStatus,
                activeProjectId,
                lastStatusUpdate,
                cachedApplicationDraft: initialContent,
            };
        }

        // Find the LATEST state of THIS specific application anywhere in the thread
        const latestEvent = findLatestApplicationEvent(messages, baseApplicationId!);
        
        // If the active capability says a DIFFERENT application is active, we just use the latest event for THIS one.
        // If this one is the active one, we use capability status if available.
        const isActiveApp = capability?.activeApplicationId === baseApplicationId;
        const currentStatus = isActiveApp && capability?.activeApplicationStatus 
            ? capability.activeApplicationStatus 
            : latestEvent?.status ?? 'pending';

        if (currentStatus === 'project_deleted') {
            return {
                mode: 'passive' as const,
                title: 'Project deleted',
                description: 'This project was deleted, so this application is now read-only.',
            };
        }

        const reasonCode = latestEvent?.reasonCode ?? (typeof metadata.reasonCode === 'string' ? metadata.reasonCode : null);
        const decisionAt = latestEvent?.eventAtMs ? new Date(latestEvent.eventAtMs).toISOString() : null;
        const lastStatusUpdate = decisionAt ? formatDistanceToNow(new Date(decisionAt), { addSuffix: true }) : null;
        const activeProjectId = capability?.activeProjectId ?? latestEvent?.projectId ?? null;

        return {
            mode: 'workflow' as const,
            applicationId: baseApplicationId!,
            status: currentStatus,
            reasonCode,
            activeProjectId,
            lastStatusUpdate,
            cachedApplicationDraft: initialContent,
        };
    }, [capability, messages, baseApplicationId, workflowItemId, isInvite, structured, initialContent, metadata]);

    const handleAction = async (action: RequestAction) => {
        if (!banner || banner.mode !== 'workflow' || !('applicationId' in banner)) return;
        const appId = banner.applicationId;
        if (!appId) return;
        setRequestLoading(action);
        try {
            const idempotencyKey = `chat-v2:${action}:${appId}`;
            const result = action === 'accept'
                ? await acceptApplicationAction(appId, undefined, { idempotencyKey })
                : action === 'reject'
                    ? await rejectApplicationAction(appId, undefined, 'other', { idempotencyKey })
                    : action === 'withdraw'
                        ? await withdrawApplicationAction(appId, undefined, { idempotencyKey })
                        : action === 'reopen'
                            ? await reopenApplicationAction(appId, undefined, { idempotencyKey })
                            : action === 'accept_proposed'
                                ? await acceptProposedRoleAction(appId, { idempotencyKey })
                                : await declineProposedRoleAction(appId, { idempotencyKey });

            if (!result.success) {
                toast.error(result.error || `Failed to ${action}`);
                return;
            }
            toast.success(
                action === 'withdraw'
                    ? 'Application withdrawn'
                    : action === 'reopen'
                        ? 'Application reopened'
                        : action === 'accept_proposed'
                            ? 'Proposed role accepted'
                            : action === 'decline_proposed'
                                ? 'Proposed role declined'
                                : `Application ${action}ed`,
            );
            await refreshConversationCache(queryClient, conversationId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update application');
        } finally {
            setRequestLoading(null);
        }
    };

    const handleResolveWorkflow = async (action: 'accept' | 'decline') => {
        if (!workflowItemId || workflowActionLoading) return;
        setWorkflowActionLoading(true);
        try {
            await resolveWorkflow.mutateAsync({
                workflowItemId,
                action,
            });
            toast.success(`Invitation ${action === 'accept' ? 'accepted' : 'declined'}`);
            await refreshConversationCache(queryClient, conversationId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update workflow');
        } finally {
            setWorkflowActionLoading(false);
        }
    };

    const handleEditOpen = () => {
        if (!banner || banner.mode !== 'workflow') return;
        setEditDraft(banner.cachedApplicationDraft);
        setIsEditOpen(true);
    };

    const handleEditSubmit = async () => {
        if (!banner || banner.mode !== 'workflow' || !('applicationId' in banner)) return;
        const appId = banner.applicationId;
        if (!appId) return;
        const nextMessage = editDraft.trim();
        if (!nextMessage) {
            toast.error('Application message cannot be empty');
            return;
        }

        setIsEditSaving(true);
        try {
            const idempotencyKey = `chat-v2:edit:${appId}:${hashText(nextMessage)}`;
            const result = await editPendingApplicationAction(appId, nextMessage, { idempotencyKey });
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
            <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-white/70 p-1.5 dark:bg-black/10">
                        <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold">{banner.title}</div>
                        <div className="mt-1 text-xs opacity-80">{banner.description}</div>
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
    const isRejected = status === 'rejected' || status === 'declined';
    const isWithdrawn = status === 'withdrawn';
    const isProposed = status === 'proposed';

    const currentStyle = {
        container: 'bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 shadow-sm',
        title: 'text-zinc-900 dark:text-zinc-100',
        text: 'text-zinc-650 dark:text-zinc-400 font-medium',
    };

    const displayRole = isProposed && typeof metadata.roleTitle === 'string' ? metadata.roleTitle : roleTitle;
    const title = isProposed
        ? 'Role Change Proposed'
        : `Application for ${displayRole}`;

    // Extract metadata (e.g. GitHub: url) from the end of the message so it doesn't extend the quote line
    const lines = (initialContent || '').split('\n');
    const messageLines: string[] = [];
    const extractedMetadata: { key: string; value: string }[] = [];
    
    let isParsingMetadata = true;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!.trim();
        if (!line) {
            if (!isParsingMetadata) messageLines.unshift(line);
            continue;
        }
        
        const match = line.match(/^([A-Za-z0-9\s]+):\s*(.+)$/i);
        if (isParsingMetadata && match && match[1]!.length < 25) {
            extractedMetadata.unshift({ key: match[1]!.trim(), value: match[2]!.trim() });
        } else {
            isParsingMetadata = false;
            messageLines.unshift(line);
        }
    }
    const messageBody = isInvite
        ? initialContent.trim()
        : messageLines.join('\n').trim();

    const BadgeIcon = isAccepted ? CheckCircle2 : (isRejected || isWithdrawn) ? XCircle : Clock3;
    const badgeColor = isAccepted
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
        : (isRejected || isWithdrawn)
            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
            : isProposed
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
    const badgeText = isAccepted
        ? 'Accepted'
        : isWithdrawn
            ? 'Withdrawn'
            : isRejected
                ? (status === 'declined' ? 'Declined' : 'Rejected')
                : isProposed
                    ? 'Proposal'
                    : 'Pending';

    return (
        <div className={`my-2 flex flex-col overflow-hidden rounded-xl border ${currentStyle.container}`}>
            <div className="flex items-start gap-4 p-5 pb-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                        <div className={`font-semibold ${currentStyle.title} text-[15px]`}>{title}</div>
                        <div className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${badgeColor}`}>
                            <BadgeIcon className="h-3.5 w-3.5" />
                            {badgeText}
                        </div>
                    </div>
                    <div className={`mt-1 text-sm ${currentStyle.text}`}>
                        Project: {projectTitle}
                    </div>
                    {isProposed && (
                        <div className="mt-2 flex flex-col gap-1 text-xs font-medium text-zinc-500">
                            <div>
                                Original Role: <span className="text-zinc-700 dark:text-zinc-300">{typeof metadata.originalRoleTitle === 'string' ? metadata.originalRoleTitle : 'Unknown Role'}</span>
                            </div>
                            <div>
                                Proposed Role: <span className="text-zinc-700 dark:text-zinc-300">{displayRole}</span>
                            </div>
                        </div>
                    )}
                    
                    {messageBody && (
                        <div className="mt-3.5 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3.5 text-sm text-zinc-650 dark:border-zinc-800/50 dark:bg-zinc-900/20 dark:text-zinc-405 whitespace-pre-wrap leading-relaxed">
                            {messageBody}
                        </div>
                    )}
                    
                    {extractedMetadata.length > 0 && (
                        <div className="mt-4 flex flex-col gap-1.5 text-sm">
                            {extractedMetadata.map((meta, i) => (
                                <div key={i} className="flex items-start gap-2">
                                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">{meta.key}:</span>
                                    {meta.value.startsWith('http') ? (
                                        <a href={meta.value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                                            {meta.value}
                                        </a>
                                    ) : (
                                        <span className="text-zinc-700 dark:text-zinc-300 break-words">{meta.value}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between border-t border-black/5 dark:border-white/5 bg-black/5 dark:bg-black/20 px-4 py-2.5">
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    {banner.lastStatusUpdate ? `Updated ${banner.lastStatusUpdate}` : 'Status pending'}
                </div>
                <div className="flex items-center gap-2">
                    {/* Invite actions */}
                    {isInvite && isPending && isAssignee ? (
                        <>
                            <button
                                onClick={() => void handleResolveWorkflow('decline')}
                                disabled={workflowActionLoading}
                                className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-3 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                {workflowActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Decline'}
                            </button>
                            <button
                                onClick={() => void handleResolveWorkflow('accept')}
                                disabled={workflowActionLoading}
                                className="flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                                {workflowActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Accept'}
                            </button>
                        </>
                    ) : null}

                    {/* Original Application actions */}
                    {!isInvite && isCreator && isPending ? (
                        <>
                            <button
                                onClick={() => void handleAction('reject')}
                                disabled={requestLoading !== null}
                                className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-3 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                {requestLoading === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reject'}
                            </button>
                            <button
                                onClick={() => void handleAction('accept')}
                                disabled={requestLoading !== null}
                                className="flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                                {requestLoading === 'accept' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Accept'}
                            </button>
                        </>
                    ) : null}

                    {!isInvite && isApplicant && isPending ? (
                        <>
                            <button
                                onClick={() => void handleAction('withdraw')}
                                disabled={requestLoading !== null || isEditSaving}
                                className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-3 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                {requestLoading === 'withdraw' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Withdraw'}
                            </button>
                            <button
                                onClick={handleEditOpen}
                                disabled={requestLoading !== null || isEditSaving}
                                className="h-7 rounded-md border border-zinc-200 px-3 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                Edit Message
                            </button>
                        </>
                    ) : null}

                    {!isInvite && isApplicant && isProposed ? (
                        <>
                            <button
                                onClick={() => void handleAction('decline_proposed')}
                                disabled={requestLoading !== null}
                                className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-3 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                {requestLoading === 'decline_proposed' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Decline Proposal'}
                            </button>
                            <button
                                onClick={() => void handleAction('accept_proposed')}
                                disabled={requestLoading !== null}
                                className="flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                                {requestLoading === 'accept_proposed' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Accept Proposed'}
                            </button>
                        </>
                    ) : null}

                    {!isInvite && isCreator && isRejected ? (
                        <button
                            onClick={() => void handleAction('reopen')}
                            disabled={requestLoading !== null}
                            className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-3 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            {requestLoading === 'reopen' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reopen'}
                        </button>
                    ) : null}

                    {isAccepted && banner.activeProjectId ? (
                        <Link
                            href={`/projects/${banner.activeProjectId}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                        >
                            Open Project
                            <ArrowRight className="h-3 w-3" />
                        </Link>
                    ) : null}

                </div>
            </div>

            <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit application message</DialogTitle>
                        <DialogDescription>
                            Keep it concise. Changes will sync into this chat thread.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        rows={6}
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
                            {isEditSaving ? 'Saving...' : 'Save message'}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
