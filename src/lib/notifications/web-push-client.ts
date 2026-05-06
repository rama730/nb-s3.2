import {
    deletePushSubscriptionAction,
    savePushSubscriptionAction,
    touchPushSubscriptionAction,
} from "@/app/actions/push-subscriptions";
import { logger } from "@/lib/logger";

export type WebPushClientStatus = "unsupported" | "denied" | "idle" | "subscribed";
export type WebPushUnsubscribeResult =
    | { ok: true; serverCleanupFailed?: boolean }
    | { ok: false; reason: string };

function urlBase64ToApplicationServerKey(base64: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(normalized);
    const buffer = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i += 1) {
        view[i] = raw.charCodeAt(i);
    }
    return view;
}

function extractKey(sub: PushSubscription, name: "p256dh" | "auth"): string | null {
    const raw = sub.getKey(name);
    if (!raw) return null;
    let binary = "";
    const bytes = new Uint8Array(raw);
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bufferSourceToUint8Array(value: BufferSource): Uint8Array {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function pushSubscriptionKeyMatches(existingKey: BufferSource | null, expectedKey: Uint8Array): boolean {
    if (!existingKey) return false;
    const currentKey = bufferSourceToUint8Array(existingKey);
    return currentKey.length === expectedKey.length
        && currentKey.every((value, index) => value === expectedKey[index]);
}

export function isWebPushSupported(): boolean {
    return typeof window !== "undefined"
        && "serviceWorker" in navigator
        && "PushManager" in window
        && typeof Notification !== "undefined";
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!isWebPushSupported()) return null;
    try {
        const existing = await navigator.serviceWorker.getRegistration("/sw.js");
        if (existing) return existing;
        return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (error) {
        logger.warn("web_push.service_worker_registration_failed", { module: "notifications", error });
        return null;
    }
}

export async function getCurrentPushStatus(): Promise<WebPushClientStatus> {
    if (!isWebPushSupported()) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return "idle";
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return "idle";
    void touchPushSubscriptionAction(sub.endpoint).catch(() => {
        // Best effort freshness marker; status should still reflect browser state.
    });
    return "subscribed";
}

export async function subscribeWebPush(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!isWebPushSupported()) return { ok: false, reason: "unsupported" };
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) return { ok: false, reason: "missing_vapid_key" };

    let permission = Notification.permission;
    if (permission === "default") {
        permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return { ok: false, reason: "permission_denied" };

    const reg = await ensureServiceWorker();
    if (!reg) return { ok: false, reason: "sw_failed" };

    let subscription: PushSubscription;
    try {
        const existing = await reg.pushManager.getSubscription();
        const expectedKey = urlBase64ToApplicationServerKey(vapidPublicKey);
        const shouldResubscribe = !existing
            || !pushSubscriptionKeyMatches(existing.options.applicationServerKey, expectedKey);

        if (existing && shouldResubscribe) {
            try { await existing.unsubscribe(); } catch { /* best effort */ }
        }

        subscription = shouldResubscribe
            ? await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: expectedKey,
            })
            : existing;
    } catch (error) {
        logger.warn("web_push.subscribe_failed", { module: "notifications", error });
        return { ok: false, reason: "subscribe_failed" };
    }

    const p256dh = extractKey(subscription, "p256dh");
    const auth = extractKey(subscription, "auth");
    if (!p256dh || !auth) return { ok: false, reason: "key_extract_failed" };

    const result = await savePushSubscriptionAction({
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    if (!result.success) {
        try { await subscription.unsubscribe(); } catch { /* best effort */ }
        return { ok: false, reason: result.error || "save_failed" };
    }

    return { ok: true };
}

export async function unsubscribeWebPush(): Promise<WebPushUnsubscribeResult> {
    if (!isWebPushSupported()) return { ok: false, reason: "unsupported" };
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return { ok: true };
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch { /* best effort */ }
    try {
        const result = await deletePushSubscriptionAction(endpoint);
        if (!result.success) {
            logger.warn("web_push.delete_subscription_failed", {
                module: "notifications",
                error: result.error,
            });
            return { ok: true, serverCleanupFailed: true };
        }
    } catch (error) {
        logger.warn("web_push.delete_subscription_failed", { module: "notifications", error });
        return { ok: true, serverCleanupFailed: true };
    }
    return { ok: true };
}

export async function touchWebPushSubscription(): Promise<void> {
    if (!isWebPushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try {
        await touchPushSubscriptionAction(sub.endpoint);
    } catch {
        // non-critical
    }
}
