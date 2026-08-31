import type { MessageWithSender } from '@/app/actions/messaging';
import { getMessageCalendarDay } from '@/lib/messages/date-buckets';
import { mergeMessages } from '@/lib/messages/utils';

export type MessageThreadItem =
    | { type: 'date'; id: string; dateKey: string; date: Date }
    | { type: 'message'; id: string; message: MessageWithSender }
    | { type: 'unread-divider'; id: string; count: number };

export interface MessageThreadGroup {
    id: string;
    dateKey: string;
    date: Date;
    items: MessageThreadItem[];
}

export interface MessageThreadModel {
    messages: MessageWithSender[];
    groups: MessageThreadGroup[];
    items: MessageThreadItem[];
    unreadMessageIds: string[];
    groupCounts: number[];
    groupHeaderIndexes: number[];
    groupIndexByDataIndex: number[];
}

export function normalizeMessageThreadMessages(
    messages: ReadonlyArray<MessageWithSender>,
): MessageWithSender[] {
    return mergeMessages([], messages);
}

export function buildMessageThreadGroupHeaderIndexes(groupCounts: ReadonlyArray<number>): number[] {
    const indexes: number[] = [];
    let nextHeaderIndex = 0;

    for (const count of groupCounts) {
        indexes.push(nextHeaderIndex);
        nextHeaderIndex += count + 1;
    }

    return indexes;
}

function resolveMessageDay(message: MessageWithSender) {
    return getMessageCalendarDay(message.createdAt);
}

export function buildMessageThreadModel({
    conversationId,
    messages,
    viewerId,
    viewerUnreadCount,
}: {
    conversationId: string;
    messages: MessageWithSender[];
    viewerId: string | null;
    viewerUnreadCount: number;
}): MessageThreadModel {
    const orderedMessages = normalizeMessageThreadMessages(messages);
    const groups: MessageThreadGroup[] = [];
    const unreadCandidateIndices = orderedMessages.flatMap((message, index) => {
        if (message.deletedAt) return [];
        if (viewerId && message.senderId === viewerId) return [];
        return [index];
    });
    const normalizedUnreadCount = Math.min(
        Math.max(0, viewerUnreadCount),
        unreadCandidateIndices.length,
    );
    const firstUnreadIndex = normalizedUnreadCount > 0
        ? unreadCandidateIndices[unreadCandidateIndices.length - normalizedUnreadCount]
        : -1;
    const unreadMessageIds = normalizedUnreadCount > 0
        ? unreadCandidateIndices
            .slice(-normalizedUnreadCount)
            .map((index) => orderedMessages[index]?.id)
            .filter((id): id is string => typeof id === 'string')
        : [];
    let currentGroup: MessageThreadGroup | null = null;

    orderedMessages.forEach((message, index) => {
        const day = resolveMessageDay(message);
        if (!currentGroup || currentGroup.id !== `date-${day.key}`) {
            currentGroup = {
                id: `date-${day.key}`,
                dateKey: day.key,
                date: day.date,
                items: [],
            };
            groups.push(currentGroup);
        }

        if (index === firstUnreadIndex) {
            currentGroup.items.push({
                type: 'unread-divider',
                id: `unread-divider-${conversationId}`,
                count: normalizedUnreadCount,
            });
        }
        currentGroup.items.push({
            type: 'message',
            id: message.id,
            message,
        });
    });

    const items: MessageThreadItem[] = groups.flatMap((group) => [
        {
            type: 'date' as const,
            id: `date-header-${group.dateKey}`,
            dateKey: group.dateKey,
            date: group.date,
        },
        ...group.items,
    ]);
    const groupCounts = groups.map((group) => group.items.length);
    const groupIndexByDataIndex = groups.flatMap((group, groupIndex) =>
        group.items.map(() => groupIndex),
    );
    return {
        messages: orderedMessages,
        groups,
        items,
        unreadMessageIds,
        groupCounts,
        groupHeaderIndexes: buildMessageThreadGroupHeaderIndexes(groupCounts),
        groupIndexByDataIndex,
    };
}

export function buildMessageThreadItems(
    params: Parameters<typeof buildMessageThreadModel>[0],
): MessageThreadItem[] {
    return buildMessageThreadModel(params).items;
}
