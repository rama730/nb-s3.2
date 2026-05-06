'use client';

import { Loader2 } from 'lucide-react';
import {
    getStructuredWorkflowActionDescriptors,
    getStructuredMessageKindLabel,
    getStructuredStateLabel,
    type StructuredMessagePayload,
    type WorkflowResolutionAction,
} from '@/lib/messages/structured';
import { cn } from '@/lib/utils';
import { MessageContextChipRowV2 } from './MessageContextChipRowV2';

interface StructuredMessageCardV2Props {
    structured: StructuredMessagePayload;
    isOwn: boolean;
    currentUserId?: string | null;
    creatorId?: string | null;
    isActionLoading?: boolean;
    onResolveAction?: (action: WorkflowResolutionAction) => void;
}

function actionLabel(kind: StructuredMessagePayload['kind']) {
    switch (kind) {
        case 'project_invite':
            return 'Invitation';
        case 'feedback_request':
            return 'Feedback';
        case 'availability_request':
            return 'Availability';
        case 'task_approval':
            return 'Approval';
        case 'rate_share':
            return 'Rate';
        case 'handoff_summary':
            return 'Handoff';
        case 'activity_bridge':
            return 'Update';
        default:
            return getStructuredMessageKindLabel(kind);
    }
}

export function StructuredMessageCardV2({
    structured,
    isOwn,
    currentUserId = null,
    creatorId = null,
    isActionLoading = false,
    onResolveAction,
}: StructuredMessageCardV2Props) {
    const stateLabel = getStructuredStateLabel(structured.stateSnapshot);
    const workflowActions = onResolveAction
        ? getStructuredWorkflowActionDescriptors({
            kind: structured.kind,
            currentUserId,
            creatorId,
            assigneeUserId: structured.entityRefs.profileId ?? null,
            status: structured.stateSnapshot?.status === 'shared'
                ? null
                : structured.stateSnapshot?.status,
        })
        : [];
    const payload = (structured.payload || {}) as Record<string, unknown>;
    const note = typeof payload.note === 'string' && payload.note.trim()
        ? payload.note.trim()
        : null;
    const handoffCompleted = typeof payload.completed === 'string' && payload.completed.trim() ? payload.completed.trim() : null;
    const handoffBlocked = typeof payload.blocked === 'string' && payload.blocked.trim() ? payload.blocked.trim() : null;
    const handoffNext = typeof payload.next === 'string' && payload.next.trim() ? payload.next.trim() : null;

    return (
        <div className={cn(
            'msg-rich-content w-full max-w-full min-w-0 rounded-2xl border px-3 py-3',
            isOwn
                ? 'border-white/15 bg-white/8 text-primary-foreground'
                : 'border-zinc-200 bg-zinc-50/90 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-100',
        )}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        isOwn ? 'bg-white/10 text-white/75' : 'bg-primary/10 text-primary',
                    )}>
                        {actionLabel(structured.kind)}
                    </span>
                    {stateLabel ? (
                        <span className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            isOwn
                                ? 'border-white/15 bg-white/5 text-white/80'
                                : 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
                        )}>
                            {stateLabel}
                        </span>
                    ) : null}
                </div>
                {isActionLoading ? (
                    <span className="inline-flex items-center" role="status" aria-live="polite">
                        <Loader2
                            aria-hidden="true"
                            className="h-3.5 w-3.5 animate-spin opacity-70"
                        />
                        <span className="sr-only">Action loading</span>
                    </span>
                ) : null}
            </div>

            <div className="mt-2 break-words text-sm font-semibold leading-5">
                {structured.title}
            </div>
            <div className={cn(
                'mt-1 break-words text-sm leading-6',
                isOwn ? 'text-primary-foreground/85' : 'text-zinc-600 dark:text-zinc-300',
            )}>
                {structured.summary}
            </div>

            {note ? (
                <div className={cn(
                    'mt-2 rounded-xl border px-2.5 py-2 text-xs leading-5 break-words',
                    isOwn
                        ? 'border-white/10 bg-black/10 text-primary-foreground/80'
                        : 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
                )}>
                    {note}
                </div>
            ) : null}

            {structured.kind === 'handoff_summary' && (handoffCompleted || handoffBlocked || handoffNext) ? (
                <div className="mt-3 space-y-2 text-xs">
                    {handoffCompleted ? (
                        <div>
                            <div className={cn('font-semibold uppercase tracking-wide', isOwn ? 'text-white/75' : 'text-zinc-500 dark:text-zinc-400')}>Completed</div>
                            <div className={cn('mt-1 break-words leading-5', isOwn ? 'text-white/85' : 'text-zinc-700 dark:text-zinc-200')}>{handoffCompleted}</div>
                        </div>
                    ) : null}
                    {handoffBlocked ? (
                        <div>
                            <div className={cn('font-semibold uppercase tracking-wide', isOwn ? 'text-white/75' : 'text-zinc-500 dark:text-zinc-400')}>Blocked</div>
                            <div className={cn('mt-1 break-words leading-5', isOwn ? 'text-white/85' : 'text-zinc-700 dark:text-zinc-200')}>{handoffBlocked}</div>
                        </div>
                    ) : null}
                    {handoffNext ? (
                        <div>
                            <div className={cn('font-semibold uppercase tracking-wide', isOwn ? 'text-white/75' : 'text-zinc-500 dark:text-zinc-400')}>Next</div>
                            <div className={cn('mt-1 break-words leading-5', isOwn ? 'text-white/85' : 'text-zinc-700 dark:text-zinc-200')}>{handoffNext}</div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <MessageContextChipRowV2
                chips={structured.contextChips}
                tone={isOwn ? 'inverted' : 'default'}
                compact
            />

            {workflowActions.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {workflowActions.map((action) => (
                        <button
                            key={action.action}
                            type="button"
                            onClick={() => onResolveAction?.(action.action)}
                            disabled={isActionLoading}
                            className={cn(
                                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                                action.tone === 'primary'
                                    ? (isOwn
                                        ? 'bg-white/10 hover:bg-white/15'
                                        : 'bg-primary text-primary-foreground hover:bg-primary/90')
                                    : (isOwn
                                        ? 'border border-white/15 hover:bg-white/10'
                                        : 'border border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'),
                            )}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
