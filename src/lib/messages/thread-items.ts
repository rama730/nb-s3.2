import type { MessageWithSender } from '@/app/actions/messaging';
import { getMessageCalendarDay } from '@/lib/messages/date-buckets';
import { mergeMessages } from '@/lib/messages/utils';

export type MessageThreadItem =
    | { type: 'message'; id: string; message: MessageWithSender; showAvatar: boolean }
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
            showAvatar: false,
        });
    });

    const decoratedGroups = groups.map((group) => ({
        ...group,
        items: group.items.map((item, index): MessageThreadItem => {
            if (item.type !== 'message') {
                return item;
            }

            const nextItem = group.items[index + 1];
            const nextMessageFromSameSender = nextItem?.type === 'message'
                && nextItem.message.senderId === item.message.senderId;
            const isPeerMessage = Boolean(item.message.senderId)
                && (!viewerId || item.message.senderId !== viewerId);

            return {
                ...item,
                showAvatar: isPeerMessage && !nextMessageFromSameSender,
            };
        }),
    }));

    const items = decoratedGroups.flatMap((group) => group.items);
    const groupCounts = decoratedGroups.map((group) => group.items.length);
    const groupIndexByDataIndex = decoratedGroups.flatMap((group, groupIndex) =>
        group.items.map(() => groupIndex),
    );
    return {
        messages: orderedMessages,
        groups: decoratedGroups,
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
