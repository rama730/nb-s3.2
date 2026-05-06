"use server";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

type SaveSubscriptionInput = {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
};

function validateInput(input: SaveSubscriptionInput): input is SaveSubscriptionInput {
    return (
        typeof input.endpoint === "string" && input.endpoint.startsWith("https://") &&
        typeof input.p256dh === "string" && input.p256dh.length > 0 &&
        typeof input.auth === "string" && input.auth.length > 0
    );
}

export async function savePushSubscriptionAction(input: SaveSubscriptionInput) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: "Unauthorized" };
        if (!validateInput(input)) return { success: false as const, error: "Invalid subscription" };

        const userAgent = typeof input.userAgent === "string" ? input.userAgent.slice(0, 500) : null;
        const now = new Date();
        const [savedSubscription] = await db
            .insert(pushSubscriptions)
            .values({
                userId: user.id,
                endpoint: input.endpoint,
                p256dh: input.p256dh,
                auth: input.auth,
                userAgent,
                lastSeenAt: now,
                failureCount: 0,
            })
            .onConflictDoUpdate({
                target: pushSubscriptions.endpoint,
                set: {
                    p256dh: input.p256dh,
                    auth: input.auth,
                    userAgent,
                    lastSeenAt: now,
                    failureCount: 0,
                    updatedAt: now,
                },
                where: eq(pushSubscriptions.userId, user.id),
            })
            .returning({ id: pushSubscriptions.id });

        if (!savedSubscription) {
            logger.warn("push_subscriptions.cross_user_endpoint_conflict", {
                module: "notifications",
                userId: user.id,
                failureReason: "endpoint_owned_by_another_user",
            });
            return { success: false as const, error: "Subscription could not be saved for this account" };
        }

        return { success: true as const };
    } catch (error: any) {
        logger.error("push_subscriptions.save_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: "Failed to save subscription" };
    }
}

export async function deletePushSubscriptionAction(endpoint: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: "Unauthorized" };
        if (typeof endpoint !== "string" || !endpoint) return { success: false as const, error: "Invalid endpoint" };

        await db
            .delete(pushSubscriptions)
            .where(and(
                eq(pushSubscriptions.userId, user.id),
                eq(pushSubscriptions.endpoint, endpoint),
            ));

        return { success: true as const };
    } catch (error: any) {
        logger.error("push_subscriptions.delete_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: "Failed to remove subscription" };
    }
}

export async function touchPushSubscriptionAction(endpoint: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: "Unauthorized" };
        if (typeof endpoint !== "string" || !endpoint) return { success: false as const, error: "Invalid endpoint" };

        await db
            .update(pushSubscriptions)
            .set({ lastSeenAt: sql`now()`, failureCount: 0, updatedAt: sql`now()` })
            .where(and(
                eq(pushSubscriptions.userId, user.id),
                eq(pushSubscriptions.endpoint, endpoint),
            ));

        return { success: true as const };
    } catch (error: any) {
        logger.error("push_subscriptions.touch_failed", {
            module: "notifications",
            error: error?.message || String(error),
        });
        return { success: false as const, error: "Failed to touch subscription" };
    }
}
