import type { NotificationImportance, NotificationKind } from "./types";

export type NotificationClass = "j1" | "j2";

/**
 * J1 = "You owe someone a response" (action-required, survives pause, important badge).
 * J2 = "Someone did a thing" (awareness, honors pause, more tab).
 * Source: /plan-ceo-review + /plan-eng-review consensus, plan §91 + §293.
 */
const J1_KIND_LIST: readonly NotificationKind[] = [
    "task_assigned",
    "task_comment_mention",
    "workflow_assigned",
    "task_file_needs_review",
    "connection_request_received",
];

const J1_KINDS: ReadonlySet<NotificationKind> = new Set(J1_KIND_LIST);

export function classifyNotificationKind(kind: NotificationKind): NotificationClass {
    return J1_KINDS.has(kind) ? "j1" : "j2";
}

export function importanceForKind(kind: NotificationKind): NotificationImportance {
    return J1_KINDS.has(kind) ? "important" : "more";
}

export function isActionRequiredKind(kind: NotificationKind): boolean {
    return J1_KINDS.has(kind);
}

export const J1_NOTIFICATION_KINDS: readonly NotificationKind[] = J1_KIND_LIST;
