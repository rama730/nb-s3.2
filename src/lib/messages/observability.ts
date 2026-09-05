import { logger } from '@/lib/logger';

export type MessagesOpenSource =
    | 'row'
    | 'notification_bell'
    | 'notification_toast'
    | 'search'
    | 'profile'
    | 'application'
    | 'project'
    | 'new_message'
    | 'popup_handoff'
    | 'direct_url';

function lengthBucket(length: number) {
    if (length <= 0) return '0';
    if (length === 1) return '1';
    if (length <= 3) return '2-3';
    if (length <= 8) return '4-8';
    if (length <= 20) return '9-20';
    return '21+';
}

function countBucket(count: number) {
    if (count <= 0) return '0';
    if (count === 1) return '1';
    if (count <= 5) return '2-5';
    if (count <= 20) return '6-20';
    return '21+';
}

export function recordMessagesOpen(params: {
    source: MessagesOpenSource;
    surface: 'page' | 'popup' | 'notification';
    hasMessageTarget: boolean;
}) {
    logger.metric('messages.open', {
        module: 'messaging',
        source: params.source,
        scope: params.surface,
        available: params.hasMessageTarget,
    });
}

export function recordMessageSearch(params: {
    queryLength: number;
    durationMs: number;
    resultCount: number;
    outcome: 'success' | 'empty' | 'invalid' | 'rate_limited' | 'error' | 'selected';
    errorCode?: string | null;
    selectedPosition?: number;
    hasMore?: boolean;
}) {
    logger.metric('messages.search', {
        module: 'messaging',
        queryLengthBucket: lengthBucket(params.queryLength),
        bucket: countBucket(params.resultCount),
        durationMs: Math.max(0, Math.round(params.durationMs)),
        outcome: params.outcome,
        errorCode: params.errorCode ?? undefined,
        offset: params.selectedPosition,
        hasMore: params.hasMore,
    });
}

export function recordMessagesPopupTransition(
    from: 'closed' | 'open' | 'minimized',
    to: 'closed' | 'open' | 'minimized',
) {
    if (from === to) return;
    logger.metric('messages.popup.transition', {
        module: 'messaging',
        eventType: `${from}:${to}`,
    });
}

export function recordMessagesPagination(_params: {
    scope: 'inbox' | 'thread' | 'search';
    outcome: 'requested' | 'suppressed';
}) {}

export function recordMessagesDraftLifecycle(
    _outcome: 'abandoned' | 'first_message_sent',
) {}

export function recordMessagesThreadState(params: {
    surface: 'page' | 'popup';
    phase: 'stable_shell' | 'cached' | 'fresh';
    durationMs: number;
}) {
    logger.metric('messages.thread.state', {
        module: 'messaging',
        scope: params.surface,
        eventType: params.phase,
        durationMs: Math.max(0, Math.round(params.durationMs)),
    });
}

export function recordMessagesThreadRecovery(params: {
    surface: 'page' | 'popup';
    action: 'failure' | 'retry';
    outcome: 'shown' | 'requested' | 'succeeded' | 'failed';
    errorCode?: string | null;
}) {
    logger.metric('messages.thread.recovery', {
        module: 'messaging',
        scope: params.surface,
        eventType: params.action,
        outcome: params.outcome,
        errorCode: params.errorCode ?? undefined,
    });
}

export function recordMessagesReadWatermark(_params: {
    cause: 'visible_unread_row';
    outcome: 'requested' | 'queued' | 'succeeded' | 'failed';
}) {}

export function recordMessagesPopupFocusReturn(succeeded: boolean) {
    logger.metric('messages.popup.focus_return', {
        module: 'messaging',
        outcome: succeeded ? 'succeeded' : 'failed',
    });
}
