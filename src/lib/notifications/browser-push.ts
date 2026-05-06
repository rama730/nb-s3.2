import type { NotificationItem } from "@/lib/notifications/types";

export type BrowserNotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export function getBrowserNotificationSupport(): BrowserNotificationPermissionState {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
        return "unsupported";
    }
    return Notification.permission as BrowserNotificationPermissionState;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
        return "unsupported";
    }
    if (Notification.permission === "granted" || Notification.permission === "denied") {
        return Notification.permission;
    }
    try {
        const result = await Notification.requestPermission();
        return result as BrowserNotificationPermissionState;
    } catch {
        return "denied";
    }
}

type ShowBrowserNotificationOptions = {
    item: NotificationItem;
    enabled: boolean;
    tabVisible: boolean;
    onClickHref?: (href: string) => void;
};

export function showBrowserNotification(options: ShowBrowserNotificationOptions): Notification | null {
    const { item, enabled, tabVisible, onClickHref } = options;
    if (!enabled) return null;
    if (tabVisible) return null;
    if (item.importance !== "important") return null;
    if (item.readAt || item.dismissedAt) return null;
    if (typeof window === "undefined" || typeof Notification === "undefined") return null;
    if (Notification.permission !== "granted") return null;

    try {
        const body = item.body ?? item.preview?.secondaryText ?? "";
        const icon = item.preview?.actorAvatarUrl ?? "/favicon.ico";
        const notification = new Notification(item.title, {
            body: body.slice(0, 240),
            icon,
            tag: item.dedupeKey,
            silent: false,
            data: { href: item.href, id: item.id },
        });
        notification.onclick = () => {
            try {
                window.focus();
            } catch {
                // best effort
            }
            if (item.href && onClickHref) {
                onClickHref(item.href);
            }
            notification.close();
        };
        return notification;
    } catch {
        return null;
    }
}
