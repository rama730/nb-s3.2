import "server-only";

import { markConversationAsRead } from "@/app/actions/messaging";
import { logger } from "@/lib/logger";

export async function syncMessageBurstConversationReads(conversationIds: string[]) {
    const uniqueIds = Array.from(new Set(conversationIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const results = await Promise.allSettled(
        uniqueIds.map((conversationId) => markConversationAsRead(conversationId)),
    );
    const failed = results.filter((result) => result.status === "rejected" || !result.value.success);
    if (failed.length > 0) {
        logger.warn("notifications.message_burst_read_sync_partial_failed", {
            module: "notifications",
            conversationIds: uniqueIds,
            failed: failed.length,
        });
    }
}
