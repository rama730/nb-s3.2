export function validateUniqueConversationIds(conversationIds: string[], source: string): void {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of conversationIds) {
        if (seen.has(id)) duplicates.push(id);
        seen.add(id);
    }
    if (duplicates.length > 0) {
        console.error(`[chat-contract] Duplicate conversation ids detected in ${source}:`, duplicates);
    }
}

export function validateSingleOutboxKey(
    outboxByConversation: Record<string, Array<{ clientMessageId: string }>>,
    source: string
): void {
    const seen = new Set<string>();
    const dupes: string[] = [];

    for (const list of Object.values(outboxByConversation)) {
        for (const item of list) {
            if (seen.has(item.clientMessageId)) dupes.push(item.clientMessageId);
            seen.add(item.clientMessageId);
        }
    }

    if (dupes.length > 0) {
        console.error(`[chat-contract] Duplicate outbox clientMessageId detected in ${source}:`, dupes);
    }
}
