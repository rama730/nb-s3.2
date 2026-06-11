import type { MessageWithSender } from '@/app/actions/messaging';

export type ApplicationBannerStatus = 'pending' | 'accepted' | 'rejected' | 'project_deleted';

export interface ApplicationEvent {
    applicationId: string | null;
    projectId: string | null;
    status: ApplicationBannerStatus;
    reasonCode: string | null;
    eventAtMs: number;
}

export function hashText(input: string) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

export function extractApplicationBody(content: string | null) {
    const value = (content || '').trim();
    if (!value) return '';
    const blocks = value.split(/\n\s*\n/);
    if (blocks.length <= 1) return value;
    return blocks.slice(1).join('\n\n').trim();
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

export function readApplicationStatus(value: unknown): ApplicationBannerStatus | null {
    if (value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'project_deleted') {
        return value;
    }
    return null;
}

export function readApplicationEvent(
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

export function findLatestApplicationEvent(
    messages: MessageWithSender[],
    preferredApplicationId: string | null,
): ApplicationEvent | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const msg = messages[index];
        if (!msg) continue;
        const event = readApplicationEvent(msg, preferredApplicationId);
        if (event) return event;
    }

    if (preferredApplicationId) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const msg = messages[index];
            if (!msg) continue;
            const event = readApplicationEvent(msg, null);
            if (event) return event;
        }
    }

    return null;
}
