import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
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
    const [inserted] = await executor
        .insert(messageWorkLinks)
        .values({
            ...values,
            updatedAt: new Date(),
        })
        .onConflictDoNothing({
            target: [
                messageWorkLinks.sourceMessageId,
                messageWorkLinks.targetType,
                messageWorkLinks.targetId,
            ],
            where: isNull(messageWorkLinks.deletedAt),
        })
        .returning();

    if (inserted) return inserted;

    const [existing] = await executor
        .select()
        .from(messageWorkLinks)
        .where(and(
            eq(messageWorkLinks.sourceMessageId, values.sourceMessageId),
            eq(messageWorkLinks.targetType, values.targetType),
            eq(messageWorkLinks.targetId, values.targetId),
            isNull(messageWorkLinks.deletedAt),
        ))
        .limit(1);

    if (existing) return existing;

    const [restored] = await executor
        .update(messageWorkLinks)
        .set({
            ...values,
            deletedAt: null,
            updatedAt: new Date(),
        })
        .where(and(
            eq(messageWorkLinks.sourceMessageId, values.sourceMessageId),
            eq(messageWorkLinks.targetType, values.targetType),
            eq(messageWorkLinks.targetId, values.targetId),
            isNotNull(messageWorkLinks.deletedAt),
        ))
        .returning();

    if (restored) return restored;

    throw new Error("Failed to create message work link");
}

export function visibleMessageWorkLinkPredicate(userId: string) {
    return and(
        isNull(messageWorkLinks.deletedAt),
        or(
            eq(messageWorkLinks.visibility, "shared"),
            eq(messageWorkLinks.ownerUserId, userId),
            eq(messageWorkLinks.createdBy, userId),
        ),
    );
}
