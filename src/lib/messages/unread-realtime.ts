import type { MessagingNotificationEvent } from "@/lib/realtime/subscriptions";

type ParticipantState = Map<string, string>;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getConversationId(row: unknown) {
    const values = asRecord(row);
    return typeof values.conversation_id === "string" ? values.conversation_id : null;
}

function participantStateFromRow(row: unknown) {
    const values = asRecord(row);
    const conversationId = typeof values.conversation_id === "string" ? values.conversation_id : null;
    const unreadCount = typeof values.unread_count === "number" ? values.unread_count : null;
    const archivedAt = values.archived_at === null || typeof values.archived_at === "string"
        ? values.archived_at
        : undefined;

    return conversationId && unreadCount !== null && archivedAt !== undefined
        ? [conversationId, `${unreadCount}|${archivedAt ?? ""}`] as const
        : null;
}

/**
 * Conversation participant rows also change for previews, reads, and metadata.
 * Only unread or archive changes can alter the global unread total.
 */
export function shouldRefreshUnreadSummary(
    event: MessagingNotificationEvent,
    participantStates: ParticipantState,
) {
    if (event.kind === "message_visibility") return true;

    const oldState = participantStateFromRow(event.payload.old);
    const nextState = participantStateFromRow(event.payload.new);

    if (event.payload.eventType === "DELETE") {
        if (oldState) participantStates.delete(oldState[0]);
        return true;
    }
    if (!nextState) return event.payload.eventType === "INSERT";

    const [conversationId, nextValue] = nextState;
    const previousValue = participantStates.get(conversationId);
    participantStates.set(conversationId, nextValue);

    if (event.payload.eventType === "INSERT") return true;
    if (oldState) return oldState[1] !== nextValue;
    return previousValue === undefined || previousValue !== nextValue;
}

/** Keeps the cached inbox in step with the participant projection, not every row write. */
export function shouldRefreshInboxSummary(
    event: MessagingNotificationEvent,
    participantStates: ParticipantState,
) {
    if (event.kind !== "conversation_participant") return false;

    const next = asRecord(event.payload.new);
    const previous = asRecord(event.payload.old);
    const conversationId = getConversationId(next) ?? getConversationId(previous);
    if (!conversationId) return event.payload.eventType === "DELETE";
    if (event.payload.eventType === "DELETE") {
        participantStates.delete(conversationId);
        return true;
    }

    const state = [
        next.last_message_id,
        next.last_message_at,
        next.last_message_preview,
        next.last_message_type,
        next.last_message_sender_id,
        next.archived_at,
    ].map((value) => value ?? "").join("|");
    const previousState = participantStates.get(conversationId);
    participantStates.set(conversationId, state);
    return event.payload.eventType === "INSERT" || previousState === undefined || previousState !== state;
}
