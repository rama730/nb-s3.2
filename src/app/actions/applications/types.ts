import type { ApplicationCoreStatus, ApplicationLifecycleStatus, ApplicationLifecycleStatusWithNone } from '@/lib/applications/status';
import type { ApplicationDecisionReasonCode } from '@/lib/applications/reasons';

export type ApplicationActionErrorCode =
    | 'UNAUTHORIZED'
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'PROJECT_NOT_FOUND'
    | 'ROLE_NOT_FOUND'
    | 'ROLE_FULL'
    | 'ALREADY_MEMBER'
    | 'ALREADY_PROCESSED'
    | 'INVALID_STATE'
    | 'COOLDOWN_ACTIVE'
    | 'RATE_LIMITED'
    | 'EDIT_WINDOW_EXPIRED'
    | 'REOPEN_WINDOW_EXPIRED'
    | 'FORBIDDEN'
    | 'INTERNAL_ERROR';

export type ApplicationActionOptions = {
    idempotencyKey?: string | null;
    applicationTraceId?: string | null;
};

export type ApplicationActionResult = {
    success: boolean;
    error?: string;
    errorCode?: ApplicationActionErrorCode;
    applicationId?: string;
    conversationId?: string;
    applicationTraceId?: string;
    idempotent?: boolean;
};

export type ApplicationStatusResult = {
    status: ApplicationCoreStatus;
    roleId?: string;
    roleTitle?: string;
    decisionReason?: ApplicationDecisionReasonCode | null;
    lifecycleStatus?: ApplicationLifecycleStatusWithNone;
    canReapply?: boolean;
    waitTime?: string;
    updatedAt?: Date;
};

export interface ApplicationRequestHistoryItem {
    id: string;
    kind: 'application';
    direction: 'incoming' | 'outgoing';
    status: ApplicationLifecycleStatus;
    decisionReason?: string | null;
    eventAt: string;
    createdAt: string;
    conversationId?: string | null;
    project: {
        id: string;
        title: string;
        slug: string | null;
    };
    roleTitle: string;
    user: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    } | null;
}

export type ApplicationCursorPaginationInput = {
    limit?: number;
    cursor?: string | null;
};

export type ApplicationCursorPageInfo = {
    hasMore: boolean;
    nextCursor: string | null;
};
