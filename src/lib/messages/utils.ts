import type { MessageWithSender } from '@/app/actions/messaging';

/**
 * Convert any date-like value to epoch milliseconds.
 * Returns 0 for invalid/missing values.
 */
export function toEpochMs(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    return 0;
}

/**
 * Rank messages by delivery state for merge conflict resolution.
 * Higher rank = more authoritative version.
 */
export function getDeliveryRank(message: MessageWithSender): number {
    const deliveryState = (message.metadata?.deliveryState as string | undefined) ?? null;
    if (message.id.startsWith('temp-')) return 0;
    if (deliveryState === 'queued') return 1;
    if (deliveryState === 'sending') return 2;
    if (deliveryState === 'failed') return 3;
    return 4;
}

function isTemporaryMessageId(id: string): boolean {
    return id.startsWith('temp-');
}

/**
 * Pick the preferred version when two message records represent the same message.
 */
export function pickPreferredMessage(
    current: MessageWithSender,
    candidate: MessageWithSender,
): MessageWithSender {
    const currentRank = getDeliveryRank(current);
    const candidateRank = getDeliveryRank(candidate);
    if (candidateRank !== currentRank) {
        return candidateRank > currentRank ? candidate : current;
    }

    const editedDiff = toEpochMs(candidate.editedAt) - toEpochMs(current.editedAt);
    if (editedDiff !== 0) return editedDiff > 0 ? candidate : current;

    const createdDiff = toEpochMs(candidate.createdAt) - toEpochMs(current.createdAt);
    if (createdDiff !== 0) return createdDiff > 0 ? candidate : current;

    const currentIsTemporary = isTemporaryMessageId(current.id);
    const candidateIsTemporary = isTemporaryMessageId(candidate.id);
    if (currentIsTemporary !== candidateIsTemporary) {
        return currentIsTemporary ? candidate : current;
    }

    if (candidate.id === current.id) {
        return candidate;
    }

    return candidate.id.localeCompare(current.id) >= 0 ? candidate : current;
}

/**
 * Merge two sets of messages, deduplicating by ID and clientMessageId.
 * Used by both the cache layer and the hook layer.
 */
export function mergeMessages(
    currentMessages: ReadonlyArray<MessageWithSender>,
    nextMessages: ReadonlyArray<MessageWithSender>,
): MessageWithSender[] {
    const byId = new Map<string, MessageWithSender>();
    const byClientMessageId = new Map<string, string>();

    for (const message of [...currentMessages, ...nextMessages]) {
        const existingById = byId.get(message.id);
        const clientMessageId = message.clientMessageId ?? null;
        const existingByClientId = clientMessageId ? byClientMessageId.get(clientMessageId) : null;
        const existing = existingById ?? (existingByClientId ? byId.get(existingByClientId) : undefined);

        if (!existing) {
            byId.set(message.id, message);
            if (clientMessageId) byClientMessageId.set(clientMessageId, message.id);
            continue;
        }

        const preferred = pickPreferredMessage(existing, message);
        if (preferred.id !== existing.id) {
            byId.delete(existing.id);
        }
        byId.set(preferred.id, preferred);
        if (preferred.clientMessageId) {
            byClientMessageId.set(preferred.clientMessageId, preferred.id);
        }
    }

    return Array.from(byId.values()).sort((left, right) => {
        const createdDiff = toEpochMs(left.createdAt) - toEpochMs(right.createdAt);
        if (createdDiff !== 0) return createdDiff;
        return left.id.localeCompare(right.id);
    });
}

/**
 * Merge multiple message collections (variadic version for hook layer).
 */
export function mergeMessageCollections(
    ...collections: ReadonlyArray<ReadonlyArray<MessageWithSender>>
): MessageWithSender[] {
    const normalizedCollections = collections.filter(Array.isArray) as ReadonlyArray<ReadonlyArray<MessageWithSender>>;
    if (normalizedCollections.length === 0) return [];

    let result: MessageWithSender[] = [...normalizedCollections[0]];
    for (let i = 1; i < normalizedCollections.length; i++) {
        result = mergeMessages(result, normalizedCollections[i]);
    }
    return result;
}
