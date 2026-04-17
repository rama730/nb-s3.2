import {
    getDeliveryStateFromMetadata,
    getLastMessageDeliveryState,
} from '@/lib/messages/delivery-state';

type PreviewLike = {
    id: string;
    content?: string | null;
    metadata?: Record<string, unknown> | null;
} | null | undefined;

type MessageLike = {
    id: string;
    content: string | null;
    editedAt: unknown;
    deletedAt: unknown;
    metadata?: Record<string, unknown> | null;
};

export function areConversationPreviewStatesEqual(
    left: PreviewLike,
    right: PreviewLike,
) {
    return (
        left?.id === right?.id
        && (left?.content ?? null) === (right?.content ?? null)
        && getLastMessageDeliveryState(left) === getLastMessageDeliveryState(right)
    );
}

export function areMessageDeliveryRenderStatesEqual(
    left: MessageLike,
    right: MessageLike,
) {
    return (
        left.id === right.id
        && left.content === right.content
        && left.editedAt === right.editedAt
        && left.deletedAt === right.deletedAt
        && getDeliveryStateFromMetadata(left.metadata || {}) === getDeliveryStateFromMetadata(right.metadata || {})
    );
}
