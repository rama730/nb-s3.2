export interface MessageReactionSummary {
    emoji: string;
    count: number;
    viewerReacted: boolean;
}

type MessageReactionRow = {
    messageId: string;
    emoji: string;
    userId: string | null;
};

function sortReactionSummary(
    summary: ReadonlyArray<MessageReactionSummary>,
): MessageReactionSummary[] {
    return [...summary].sort((left, right) => {
        if (left.viewerReacted !== right.viewerReacted) {
            return left.viewerReacted ? -1 : 1;
        }
        if (left.count !== right.count) {
            return right.count - left.count;
        }
        return left.emoji.localeCompare(right.emoji);
    });
}

export function normalizeMessageReactionSummary(value: unknown): MessageReactionSummary[] {
    if (!Array.isArray(value)) return [];

    const byEmoji = new Map<string, MessageReactionSummary>();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;

        const emoji = typeof (entry as { emoji?: unknown }).emoji === 'string'
            ? (entry as { emoji: string }).emoji.trim()
            : '';
        if (!emoji) continue;

        const rawCount = (entry as { count?: unknown }).count;
        const count = typeof rawCount === 'number' && Number.isFinite(rawCount)
            ? Math.max(0, Math.floor(rawCount))
            : 0;
        if (count <= 0) continue;

        const rawViewerReacted = (entry as { viewerReacted?: unknown; reacted?: unknown }).viewerReacted;
        const rawLegacyReacted = (entry as { reacted?: unknown }).reacted;
        const viewerReacted = rawViewerReacted === true || rawLegacyReacted === true;

        const existing = byEmoji.get(emoji);
        if (!existing) {
            byEmoji.set(emoji, { emoji, count, viewerReacted });
            continue;
        }

        byEmoji.set(emoji, {
            emoji,
            count: existing.count + count,
            viewerReacted: existing.viewerReacted || viewerReacted,
        });
    }

    return sortReactionSummary(Array.from(byEmoji.values()));
}

export function buildReactionSummaryByMessage(
    rows: ReadonlyArray<MessageReactionRow>,
    viewerId: string | null,
): Record<string, MessageReactionSummary[]> {
    const grouped = new Map<string, Map<string, MessageReactionSummary>>();

    for (const row of rows) {
        const emoji = row.emoji.trim();
        if (!row.messageId || !emoji) continue;

        let messageSummary = grouped.get(row.messageId);
        if (!messageSummary) {
            messageSummary = new Map<string, MessageReactionSummary>();
            grouped.set(row.messageId, messageSummary);
        }

        const existing = messageSummary.get(emoji);
        if (!existing) {
            messageSummary.set(emoji, {
                emoji,
                count: 1,
                viewerReacted: Boolean(viewerId && row.userId === viewerId),
            });
            continue;
        }

        messageSummary.set(emoji, {
            emoji,
            count: existing.count + 1,
            viewerReacted: existing.viewerReacted || Boolean(viewerId && row.userId === viewerId),
        });
    }

    return Object.fromEntries(
        Array.from(grouped.entries()).map(([messageId, messageSummary]) => [
            messageId,
            sortReactionSummary(Array.from(messageSummary.values())),
        ]),
    );
}

export function toggleMessageReactionSummary(
    reactions: ReadonlyArray<MessageReactionSummary>,
    emoji: string,
): MessageReactionSummary[] {
    const normalizedEmoji = emoji.trim();
    if (!normalizedEmoji) {
        return normalizeMessageReactionSummary(reactions);
    }

    const current = normalizeMessageReactionSummary(reactions);
    const existing = current.find((reaction) => reaction.emoji === normalizedEmoji);

    if (!existing) {
        return sortReactionSummary([
            ...current,
            { emoji: normalizedEmoji, count: 1, viewerReacted: true },
        ]);
    }

    if (existing.viewerReacted) {
        if (existing.count <= 1) {
            return current.filter((reaction) => reaction.emoji !== normalizedEmoji);
        }
        return sortReactionSummary(
            current.map((reaction) =>
                reaction.emoji === normalizedEmoji
                    ? { ...reaction, count: reaction.count - 1, viewerReacted: false }
                    : reaction,
            ),
        );
    }

    return sortReactionSummary(
        current.map((reaction) =>
            reaction.emoji === normalizedEmoji
                ? { ...reaction, count: reaction.count + 1, viewerReacted: true }
                : reaction,
        ),
    );
}

export function withReactionSummaryMetadata(
    metadata: Record<string, unknown> | null | undefined,
    reactionSummary: ReadonlyArray<MessageReactionSummary>,
): Record<string, unknown> {
    const nextMetadata = { ...(metadata || {}) } as Record<string, unknown>;
    const normalizedSummary = normalizeMessageReactionSummary(reactionSummary);

    if (normalizedSummary.length === 0) {
        delete nextMetadata.reactionSummary;
        return nextMetadata;
    }

    nextMetadata.reactionSummary = normalizedSummary;
    return nextMetadata;
}
