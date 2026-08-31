import { messageWorkLinks, type MessageWorkLink, type NewMessageWorkLink } from "@/lib/db/schema";

export type MessageWorkLinkInsert = Omit<NewMessageWorkLink, "id" | "createdAt" | "updatedAt" | "deletedAt">;

type DbExecutor = {
    insert: typeof import("@/lib/db").db.insert;
    select: typeof import("@/lib/db").db.select;
    update: typeof import("@/lib/db").db.update;
};

export function buildMessageSourceHref(conversationId: string, messageId: string) {
    return `/messages?conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId)}`;
}

export function mapWorkflowStatusToLinkStatus(status: string) {
    if (status === "completed" || status === "accepted") return "done";
    if (status === "declined" || status === "canceled" || status === "expired") return "dismissed";
    if (status === "needs_changes") return "blocked";
    return "pending";
}

export async function upsertMessageWorkLink(
    executor: DbExecutor,
    values: MessageWorkLinkInsert,
): Promise<MessageWorkLink> {
    const [link] = await executor
        .insert(messageWorkLinks)
        .values({
            ...values,
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: [
                messageWorkLinks.sourceMessageId,
                messageWorkLinks.targetType,
                messageWorkLinks.targetId,
            ],
            set: {
                sourceConversationId: values.sourceConversationId,
                targetProjectId: values.targetProjectId ?? null,
                visibility: values.visibility,
                status: values.status,
                ownerUserId: values.ownerUserId ?? null,
                assigneeUserId: values.assigneeUserId ?? null,
                createdBy: values.createdBy,
                href: values.href ?? null,
                metadata: values.metadata,
                deletedAt: null,
                updatedAt: new Date(),
            },
        })
        .returning();

    if (link) return link;

    throw new Error("Failed to create message work link");
}
