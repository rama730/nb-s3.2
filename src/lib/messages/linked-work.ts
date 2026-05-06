import type { MessageWorkLink } from "@/lib/db/schema";

export type MessageWorkLinkTargetType = "task" | "follow_up" | "workflow" | "file_review" | "decision";
export type MessageWorkLinkVisibility = "private" | "shared";
export type MessageWorkLinkStatus = "pending" | "active" | "done" | "dismissed" | "blocked" | "unavailable";

export interface MessageLinkedWorkSummary {
    id: string;
    sourceMessageId: string;
    sourceConversationId: string;
    targetType: MessageWorkLinkTargetType;
    targetId: string;
    targetProjectId: string | null;
    visibility: MessageWorkLinkVisibility;
    status: MessageWorkLinkStatus;
    ownerUserId: string | null;
    assigneeUserId: string | null;
    createdBy: string;
    href: string | null;
    label: string;
    subtitle: string | null;
    badge: string;
    isPrivate: boolean;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

const TARGET_BADGES: Record<MessageWorkLinkTargetType, string> = {
    task: "Task",
    follow_up: "Follow-up",
    workflow: "Workflow",
    file_review: "File review",
    decision: "Decision",
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function getString(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getDefaultLabel(targetType: MessageWorkLinkTargetType, metadata: Record<string, unknown>) {
    if (targetType === "task") {
        const taskNumber = getString(metadata, "taskNumber");
        const title = getString(metadata, "title");
        return taskNumber && title ? `Task ${taskNumber}` : title ?? "Task";
    }
    if (targetType === "follow_up") {
        const dueDate = getString(metadata, "dueDate") ?? getString(metadata, "dueAt")?.slice(0, 10) ?? getString(metadata, "dueLabel");
        return dueDate ? `Follow-up ${dueDate}` : "Follow-up";
    }
    if (targetType === "workflow") {
        return getString(metadata, "workflowLabel") ?? getString(metadata, "title") ?? "Workflow";
    }
    if (targetType === "file_review") {
        return getString(metadata, "fileName") ?? "File review";
    }
    return getString(metadata, "title") ?? "Decision";
}

export function mapMessageWorkLinkToSummary(row: MessageWorkLink): MessageLinkedWorkSummary {
    const targetType = row.targetType as MessageWorkLinkTargetType;
    const visibility = row.visibility as MessageWorkLinkVisibility;
    const status = row.status as MessageWorkLinkStatus;
    const metadata = asRecord(row.metadata);
    const label = getString(metadata, "label") ?? getDefaultLabel(targetType, metadata);
    const subtitle = getString(metadata, "subtitle")
        ?? getString(metadata, "projectTitle")
        ?? getString(metadata, "note")
        ?? null;

    return {
        id: row.id,
        sourceMessageId: row.sourceMessageId,
        sourceConversationId: row.sourceConversationId,
        targetType,
        targetId: row.targetId,
        targetProjectId: row.targetProjectId ?? null,
        visibility,
        status,
        ownerUserId: row.ownerUserId ?? null,
        assigneeUserId: row.assigneeUserId ?? null,
        createdBy: row.createdBy,
        href: row.href ?? null,
        label,
        subtitle,
        badge: TARGET_BADGES[targetType] ?? "Linked work",
        isPrivate: visibility === "private",
        metadata,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function groupLinkedWorkByMessage(
    links: MessageLinkedWorkSummary[],
): Record<string, MessageLinkedWorkSummary[]> {
    return links.reduce<Record<string, MessageLinkedWorkSummary[]>>((acc, link) => {
        if (!acc[link.sourceMessageId]) acc[link.sourceMessageId] = [];
        acc[link.sourceMessageId].push(link);
        return acc;
    }, {});
}
