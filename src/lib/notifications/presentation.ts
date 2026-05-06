import type {
    NotificationEntityRefs,
    NotificationItem,
    NotificationKind,
    NotificationMuteScope,
    NotificationReason,
    NotificationTimeGroup,
    NotificationTrayFilter,
} from "@/lib/notifications/types";

const KIND_REASON: Record<NotificationKind, NotificationReason> = {
    message_burst: "message",
    workflow_assigned: "workflow",
    workflow_resolved: "workflow",
    application_received: "application",
    application_decision: "application",
    connection_request_received: "connection",
    connection_request_accepted: "connection",
    task_assigned: "assigned",
    task_status_attention: "update",
    task_comment_mention: "mention",
    task_comment_reply: "mention",
    task_file_version: "file",
    task_file_replaced: "file",
    task_file_needs_review: "file",
};

export const REASON_LABELS: Record<NotificationReason, string> = {
    mention: "Mention",
    assigned: "Assigned",
    message: "Message",
    application: "Application",
    connection: "Connection",
    blocked: "Blocked",
    done: "Done",
    workflow: "Workflow",
    file: "File",
    update: "Update",
};

export function getNotificationReason(kind: NotificationKind, refs?: NotificationEntityRefs | null): NotificationReason {
    if (kind === "task_status_attention") {
        const status = typeof refs?.status === "string" ? refs.status : null;
        if (status === "blocked") return "blocked";
        if (status === "done") return "done";
    }
    return KIND_REASON[kind] ?? "update";
}

export function getNotificationReasonLabel(reason: NotificationReason) {
    return REASON_LABELS[reason] ?? "Update";
}

const AGGREGATE_NOUNS: Record<NotificationKind, { singular: string; plural: string }> = {
    message_burst: { singular: "message", plural: "messages" },
    workflow_assigned: { singular: "workflow", plural: "workflows" },
    workflow_resolved: { singular: "resolution", plural: "resolutions" },
    application_received: { singular: "application", plural: "applications" },
    application_decision: { singular: "decision", plural: "decisions" },
    connection_request_received: { singular: "request", plural: "requests" },
    connection_request_accepted: { singular: "connection", plural: "connections" },
    task_assigned: { singular: "assignment", plural: "assignments" },
    task_status_attention: { singular: "update", plural: "updates" },
    task_comment_mention: { singular: "mention", plural: "mentions" },
    task_comment_reply: { singular: "reply", plural: "replies" },
    task_file_version: { singular: "version", plural: "versions" },
    task_file_replaced: { singular: "replacement", plural: "replacements" },
    task_file_needs_review: { singular: "review", plural: "reviews" },
};

export function getAggregateLabel(kind: NotificationKind, count: number): string | null {
    if (count <= 1) return null;
    const nouns = AGGREGATE_NOUNS[kind];
    const noun = nouns?.plural ?? "updates";
    return `${count} new ${noun}`;
}

// -----------------------------------------------------------------------------
// Client-side bundling
//
// The server already collapses bursts that share a dedupe_key into one row with
// aggregate_count > 1. Distinct dedupe_keys that touch the same entity in a
// tight window (e.g. three different people commenting on the same task within
// an hour) still arrive as separate rows — bundle them visually so the tray
// reads "Ana, Ben and 2 others commented on <task>" instead of a wall of
// near-identical lines.
// -----------------------------------------------------------------------------

export type NotificationBundle = {
    key: string;
    lead: NotificationItem;
    items: NotificationItem[];
};

const BUNDLE_WINDOW_MS = 60 * 60 * 1000;

function bundleKeyFor(item: NotificationItem): string {
    const refs = item.entityRefs ?? {};
    const entity =
        (typeof refs.taskId === "string" && refs.taskId)
        || (typeof refs.conversationId === "string" && refs.conversationId)
        || (typeof refs.projectId === "string" && refs.projectId)
        || item.actorUserId
        || "none";
    return `${item.kind}:${entity}`;
}

/**
 * Roll adjacent notifications that share a bundle key and fall within a 1h
 * window into a single visual bundle. Input must be pre-sorted DESC by
 * updatedAt (as it is from the feed query). Totals in aggregate_count are
 * preserved on each child item so per-row counts stay truthful.
 */
export function bundleNotifications(items: NotificationItem[]): NotificationBundle[] {
    const bundles: NotificationBundle[] = [];
    const byKey = new Map<string, NotificationBundle>();
    for (const item of items) {
        const key = bundleKeyFor(item);
        const existing = byKey.get(key);
        const itemTime = new Date(item.updatedAt).getTime();
        if (
            existing
            && !Number.isNaN(itemTime)
            && new Date(existing.lead.updatedAt).getTime() - itemTime <= BUNDLE_WINDOW_MS
        ) {
            existing.items.push(item);
            continue;
        }
        const bundle: NotificationBundle = { key, lead: item, items: [item] };
        bundles.push(bundle);
        byKey.set(key, bundle);
    }
    return bundles;
}

function uniqueActorNames(items: NotificationItem[], max = 3): { names: string[]; remaining: number } {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of items) {
        const name = (item.preview?.actorName ?? "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        if (names.length < max) names.push(name);
    }
    return { names, remaining: Math.max(0, seen.size - names.length) };
}

/**
 * "Ana commented", "Ana and Ben commented", "Ana, Ben and 3 others commented".
 * Falls back to a count-only summary when we cannot resolve actor names.
 */
export function getBundleSummary(bundle: NotificationBundle): string {
    const { items } = bundle;
    if (items.length <= 1) return "";
    const reasonNoun = AGGREGATE_NOUNS[bundle.lead.kind]?.plural ?? "updates";
    const { names, remaining } = uniqueActorNames(items);
    if (names.length === 0) return `${items.length} new ${reasonNoun}`;
    if (names.length === 1 && remaining === 0) return `${names[0]}`;
    if (names.length === 2 && remaining === 0) return `${names[0]} and ${names[1]}`;
    if (remaining === 0) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const total = names.length + remaining;
    return `${names.join(", ")} and ${total - names.length} others`;
}

export function bundleUnreadCount(bundle: NotificationBundle): number {
    return bundle.items.reduce((acc, item) => (item.readAt ? acc : acc + 1), 0);
}

export function formatAbsoluteTimestamp(value: string): string | null {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export function filterNotifications(items: NotificationItem[], filter: NotificationTrayFilter) {
    if (filter === "unread") return items.filter((item) => !item.readAt);
    return items;
}

function startOfToday(now: Date) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function groupFor(item: NotificationItem, now: Date): NotificationTimeGroup {
    if (!item.seenAt && !item.readAt) return "new";
    const updatedAt = new Date(item.updatedAt);
    if (!Number.isNaN(updatedAt.getTime()) && updatedAt >= startOfToday(now)) return "today";
    return "earlier";
}

export function groupNotificationsByTime(items: NotificationItem[], now: Date = new Date()) {
    const groups: Record<NotificationTimeGroup, NotificationItem[]> = {
        new: [],
        today: [],
        earlier: [],
    };
    for (const item of items) {
        groups[groupFor(item, now)].push(item);
    }
    return groups;
}

export function buildNotificationMuteScopes(item: NotificationItem): NotificationMuteScope[] {
    const scopes: NotificationMuteScope[] = [{
        kind: "notification_type",
        value: item.kind,
        label: getNotificationReasonLabel(item.reason),
        mutedAt: null,
    }];
    const refs = item.entityRefs ?? {};
    if (refs.projectId) scopes.push({ kind: "project", value: refs.projectId, label: item.preview?.contextLabel ?? "This project", mutedAt: null });
    if (refs.taskId) scopes.push({ kind: "task", value: refs.taskId, label: item.body ?? item.title, mutedAt: null });
    if (refs.conversationId) scopes.push({ kind: "conversation", value: refs.conversationId, label: item.preview?.contextLabel ?? "This conversation", mutedAt: null });
    if (item.actorUserId) scopes.push({ kind: "person", value: item.actorUserId, label: item.preview?.actorName ?? "This person", mutedAt: null });
    return scopes;
}

export function getNarrowestNotificationMuteScope(item: NotificationItem): NotificationMuteScope {
    const scopes = buildNotificationMuteScopes(item);
    const specificityOrder: NotificationMuteScope["kind"][] = ["task", "conversation", "project", "person", "notification_type"];
    for (const kind of specificityOrder) {
        const scope = scopes.find((candidate) => candidate.kind === kind);
        if (scope) return scope;
    }
    return scopes[0]!;
}

export function resolveMuteScope(item: NotificationItem): NotificationMuteScope {
    return getNarrowestNotificationMuteScope(item);
}

export function buildNotificationHref(item: NotificationItem): string | null {
    const href = item.href?.trim();
    if (!href) return null;
    if (!href.startsWith("/")) return null;
    if (href.startsWith("//")) return null;
    return href;
}

export function notificationMatchesMuteScope(
    params: {
        kind: NotificationKind;
        actorUserId?: string | null;
        entityRefs?: NotificationEntityRefs | null;
    },
    scope: NotificationMuteScope,
) {
    const refs = params.entityRefs ?? {};
    if (scope.kind === "notification_type") return params.kind === scope.value;
    if (scope.kind === "project") return refs.projectId === scope.value || refs.projectSlug === scope.value;
    if (scope.kind === "task") return refs.taskId === scope.value;
    if (scope.kind === "conversation") return refs.conversationId === scope.value;
    if (scope.kind === "person") return params.actorUserId === scope.value;
    return false;
}

export function shouldSuppressNotificationToast(params: {
    item: NotificationItem;
    pathname: string | null;
    search: string;
    trayOpen: boolean;
    activeConversationId?: string | null;
    documentVisible?: boolean;
}) {
    const {
        item,
        pathname,
        search,
        trayOpen,
        activeConversationId = null,
        documentVisible = true,
    } = params;
    if (trayOpen || documentVisible === false) return true;
    if (item.kind !== "message_burst" && item.importance !== "important") return true;
    if (item.readAt) return true;

    const normalizedSearch = search ? (search.startsWith("?") ? search : `?${search}`) : "";
    const activePath = `${pathname ?? ""}${normalizedSearch}`;
    if (item.href && activePath && item.href === activePath) return true;

    const searchParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (item.kind === "message_burst" && pathname?.startsWith("/messages")) {
        const conversationId = item.entityRefs?.conversationId;
        if (conversationId && searchParams.get("conversationId") === conversationId) return true;
    }
    if (item.kind === "message_burst") {
        const conversationId = item.entityRefs?.conversationId;
        if (conversationId && activeConversationId === conversationId) return true;
    }
    if (
        (item.kind === "task_comment_mention" || item.kind === "task_comment_reply")
        && pathname?.startsWith("/projects/")
    ) {
        const activeTaskId = searchParams.get("drawerId");
        const activePanelTab = searchParams.get("panelTab");
        if (activeTaskId && activeTaskId === item.entityRefs?.taskId && activePanelTab === "comments") {
            return true;
        }
    }
    return false;
}

export const shouldSuppressToast = shouldSuppressNotificationToast;
