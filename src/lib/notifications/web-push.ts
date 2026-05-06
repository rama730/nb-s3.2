import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationDeliveries, pushSubscriptions } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { NotificationItem } from "@/lib/notifications/types";

type DeliveryRecord = {
    notificationId: string | null;
    userId: string;
    channel: "web_push";
    status: "delivered" | "failed" | "dropped";
    errorCode: string | null;
    errorMessage: string | null;
};

async function logDeliveries(records: DeliveryRecord[]): Promise<void> {
    if (records.length === 0) return;
    try {
        await db.insert(notificationDeliveries).values(records);
    } catch (error) {
        logger.warn("notifications.web_push_delivery_log_failed", {
            module: "notifications",
            count: records.length,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

let vapidConfigured = false;

function configureVapid(): boolean {
    if (vapidConfigured) return true;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
        return false;
    }
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidConfigured = true;
        return true;
    } catch (error) {
        logger.warn("notifications.web_push_vapid_config_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

export type WebPushPayload = {
    id: string;
    title: string;
    body: string | null;
    href: string | null;
    icon: string | null;
    tag: string;
};

function buildPayload(item: NotificationItem): WebPushPayload {
    return {
        id: item.id,
        title: item.title,
        body: (item.body ?? item.preview?.secondaryText ?? "").slice(0, 240),
        href: item.href,
        icon: item.preview?.actorAvatarUrl ?? null,
        tag: item.dedupeKey,
    };
}

type DispatchResult = {
    attempted: number;
    delivered: number;
    pruned: number;
};

export async function dispatchWebPush(userId: string, item: NotificationItem): Promise<DispatchResult> {
    if (!configureVapid()) {
        await logDeliveries([{
            notificationId: item.id,
            userId,
            channel: "web_push",
            status: "dropped",
            errorCode: "vapid_unconfigured",
            errorMessage: null,
        }]);
        return { attempted: 0, delivered: 0, pruned: 0 };
    }
    if (item.importance !== "important") {
        await logDeliveries([{
            notificationId: item.id,
            userId,
            channel: "web_push",
            status: "dropped",
            errorCode: "importance_below_threshold",
            errorMessage: null,
        }]);
        return { attempted: 0, delivered: 0, pruned: 0 };
    }

    const rows = await db
        .select({
            id: pushSubscriptions.id,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));

    if (rows.length === 0) {
        await logDeliveries([{
            notificationId: item.id,
            userId,
            channel: "web_push",
            status: "dropped",
            errorCode: "no_subscriptions",
            errorMessage: null,
        }]);
        return { attempted: 0, delivered: 0, pruned: 0 };
    }

    const payload = JSON.stringify(buildPayload(item));
    const deadEndpointIds: string[] = [];
    const deliveryRecords: DeliveryRecord[] = [];
    let delivered = 0;

    await Promise.all(rows.map(async (row) => {
        const subscription: WebPushSubscription = {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
            await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 24 });
            delivered += 1;
            deliveryRecords.push({
                notificationId: item.id,
                userId,
                channel: "web_push",
                status: "delivered",
                errorCode: null,
                errorMessage: null,
            });
        } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            const normalizedErrorMessage = error instanceof Error ? error.message : String(error);
            const errorMessage = normalizedErrorMessage.trim().slice(0, 500) || null;
            if (status === 404 || status === 410) {
                deadEndpointIds.push(row.id);
            } else {
                logger.warn("notifications.web_push_send_failed", {
                    module: "notifications",
                    statusCode: status ?? null,
                    error: normalizedErrorMessage,
                });
            }
            deliveryRecords.push({
                notificationId: item.id,
                userId,
                channel: "web_push",
                status: "failed",
                errorCode: status ? String(status) : "unknown",
                errorMessage,
            });
        }
    }));

    await logDeliveries(deliveryRecords);

    let pruned = 0;
    if (deadEndpointIds.length > 0) {
        try {
            const deleted = await db
                .delete(pushSubscriptions)
                .where(and(
                    eq(pushSubscriptions.userId, userId),
                    inArray(pushSubscriptions.id, deadEndpointIds),
                ))
                .returning({ id: pushSubscriptions.id });
            pruned = deleted.length;
        } catch (error) {
            logger.warn("notifications.web_push_prune_failed", {
                module: "notifications",
                userId,
                count: deadEndpointIds.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return { attempted: rows.length, delivered, pruned };
}
