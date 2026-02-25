import { logger } from '@/lib/logger'

type ApplicationEventName =
    | 'apply_submitted'
    | 'apply_edited'
    | 'apply_withdrawn'
    | 'apply_accepted'
    | 'apply_rejected'
    | 'apply_reopened';

type ApplicationEventPayload = {
    applicationId: string;
    projectId: string;
    actorId: string;
    roleId?: string;
    reasonCode?: string | null;
    source?: 'project' | 'messages' | 'requests' | 'system';
};

export function trackApplicationEvent(
    event: ApplicationEventName,
    payload: ApplicationEventPayload
) {
    try {
        const {
            scope: _ignoredScope,
            event: _ignoredEvent,
            at: _ignoredAt,
            ...safePayload
        } = (payload as ApplicationEventPayload & {
            scope?: unknown;
            event?: unknown;
            at?: unknown;
        });

        logger.metric(`applications.${event}`, {
            module: 'applications',
            ...safePayload,
            at: new Date().toISOString(),
        });
    } catch {
        // best-effort telemetry
    }
}
