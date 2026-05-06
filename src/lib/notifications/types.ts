export type NotificationKind =
    | "message_burst"
    | "workflow_assigned"
    | "workflow_resolved"
    | "application_received"
    | "application_decision"
    | "connection_request_received"
    | "connection_request_accepted"
    | "task_assigned"
    | "task_status_attention"
    | "task_comment_mention"
    | "task_comment_reply"
    | "task_file_version"
    | "task_file_replaced"
    | "task_file_needs_review";

export type NotificationImportance = "important" | "more";

export type NotificationReason =
    | "mention"
    | "assigned"
    | "message"
    | "application"
    | "connection"
    | "blocked"
    | "done"
    | "workflow"
    | "file"
    | "update";

export type NotificationPreferenceCategory =
    | "messages"
    | "mentions"
    | "workflows"
    | "projects"
    | "tasks"
    | "applications"
    | "connections";

export type NotificationMuteScopeKind = "notification_type" | "project" | "task" | "conversation" | "person";

export type NotificationMuteScope = {
    kind: NotificationMuteScopeKind;
    value: string;
    label?: string | null;
    mutedAt?: string | null;
};

export type NotificationQuietHours = {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
};

export type NotificationDeliveryPreferences = {
    browser: boolean;
    push: boolean;
    emailDigest: boolean;
};

export type NotificationPreferences = Record<NotificationPreferenceCategory, boolean> & {
    pausedUntil: string | null;
    mutedScopes: NotificationMuteScope[];
    quietHours: NotificationQuietHours;
    delivery: NotificationDeliveryPreferences;
};

export type NotificationEntityRefs = {
    projectId?: string | null;
    projectSlug?: string | null;
    taskId?: string | null;
    commentId?: string | null;
    conversationId?: string | null;
    workflowItemId?: string | null;
    applicationId?: string | null;
    connectionId?: string | null;
    fileId?: string | null;
    parentCommentId?: string | null;
    status?: string | null;
    createdAt?: string | null;
};

export type NotificationPreview = {
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    thumbnailUrl?: string | null;
    secondaryText?: string | null;
    contextLabel?: string | null;
    contextKind?: "project" | "task" | "conversation" | "connection" | "application" | "workflow" | "file" | null;
};

export type NotificationItem = {
    id: string;
    userId: string;
    actorUserId: string | null;
    kind: NotificationKind;
    importance: NotificationImportance;
    title: string;
    body: string | null;
    href: string | null;
    entityRefs: NotificationEntityRefs | null;
    preview: NotificationPreview | null;
    reason: NotificationReason;
    dedupeKey: string;
    aggregateCount: number;
    readAt: string | null;
    seenAt: string | null;
    dismissedAt: string | null;
    snoozedUntil: string | null;
    createdAt: string;
    updatedAt: string;
};

export type NotificationFeedPage = {
    items: NotificationItem[];
    nextCursor: string | null;
    hasMore: boolean;
    unreadCount: number;
    unreadImportantCount: number;
};

export type NotificationTrayFilter = "unread" | "all";

export type NotificationTimeGroup = "new" | "today" | "earlier";

export type NotificationFanoutInput = {
    recipientUserId: string;
    actorUserId?: string | null;
    kind: NotificationKind;
    category: NotificationPreferenceCategory;
    importance?: NotificationImportance;
    title: string;
    body?: string | null;
    href?: string | null;
    entityRefs?: NotificationEntityRefs | null;
    preview?: NotificationPreview | null;
    dedupeKey: string;
    aggregateCount?: number;
};

export type NotificationFanoutWrite = {
    operation: "create" | "aggregate";
    input: NotificationFanoutInput;
};

export type NotificationFanoutEvent = {
    writes: NotificationFanoutWrite[];
    source?: string | null;
    traceId?: string | null;
    queuedAt?: string | null;
    retryAttempt?: number | null;
};
