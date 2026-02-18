export const APPLICATION_CORE_STATUSES = ['none', 'pending', 'accepted', 'rejected'] as const;
export type ApplicationCoreStatus = (typeof APPLICATION_CORE_STATUSES)[number];

export const APPLICATION_LIFECYCLE_STATUSES = [
    'pending',
    'accepted',
    'rejected',
    'withdrawn',
    'role_filled',
] as const;
export type ApplicationLifecycleStatus = (typeof APPLICATION_LIFECYCLE_STATUSES)[number];
export type ApplicationLifecycleStatusWithNone = ApplicationLifecycleStatus | 'none';

export const CONNECTION_REQUEST_HISTORY_STATUSES = [
    'pending',
    'accepted',
    'rejected',
    'cancelled',
    'disconnected',
] as const;
export type ConnectionRequestHistoryStatus = (typeof CONNECTION_REQUEST_HISTORY_STATUSES)[number];

const APP_LIFECYCLE_SET = new Set<string>(['none', ...APPLICATION_LIFECYCLE_STATUSES]);
const CONNECTION_HISTORY_SET = new Set<string>(CONNECTION_REQUEST_HISTORY_STATUSES);

export function isApplicationLifecycleStatus(value: unknown): value is ApplicationLifecycleStatusWithNone {
    return typeof value === 'string' && APP_LIFECYCLE_SET.has(value);
}

export function isConnectionHistoryStatus(value: unknown): value is ConnectionRequestHistoryStatus {
    return typeof value === 'string' && CONNECTION_HISTORY_SET.has(value);
}
