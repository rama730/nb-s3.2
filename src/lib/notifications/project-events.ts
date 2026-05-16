import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
    profiles,
    projectFollows,
    projectMembers,
    projects,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
    PROJECT_NOTIFICATION_EVENT_REGISTRY,
    normalizeProjectMemberNotificationOverrides,
    normalizeProjectNotificationPolicy,
    resolveProjectNotificationDecision,
    type ProjectMemberNotificationOverrides,
    type ProjectNotificationEventKey,
    type ProjectNotificationRecipientGroup,
} from "@/lib/notifications/project-policy";
import { emitNotificationWrites } from "@/lib/notifications/fanout";
import type {
    NotificationEntityRefs,
    NotificationFanoutWrite,
    NotificationPreview,
} from "@/lib/notifications/types";

type ProjectNotificationRecipientContext = {
    affectedMemberId?: string | null;
    assigneeId?: string | null;
    creatorId?: string | null;
    reviewerIds?: string[] | null;
    applicantId?: string | null;
    taskParticipantIds?: string[] | null;
    directRecipientIds?: string[] | null;
};

export type EnqueueProjectNotificationEventInput = ProjectNotificationRecipientContext & {
    projectId: string;
    actorUserId?: string | null;
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    eventKey: ProjectNotificationEventKey;
    title?: string | null;
    body?: string | null;
    href?: string | null;
    entityRefs?: NotificationEntityRefs | null;
    preview?: NotificationPreview | null;
    sourceEventId?: string | null;
    aggregateCount?: number;
    includeActorRecipient?: boolean;
};

type ProjectRow = {
    id: string;
    ownerId: string;
    title: string | null;
    slug: string | null;
    visibility: string | null;
    notificationPreferences: unknown;
};

type MemberRow = {
    userId: string;
    role: string;
    notificationPreferences: unknown;
};

function displayProjectTitle(project: ProjectRow) {
    return project.title || "Project";
}

function actorLabel(input: EnqueueProjectNotificationEventInput) {
    return input.actorName || "Someone";
}

function titleFor(input: EnqueueProjectNotificationEventInput, project: ProjectRow) {
    if (input.title?.trim()) return input.title.trim();
    const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[input.eventKey];
    switch (input.eventKey) {
        case "members.joined":
            return `${actorLabel(input)} joined ${displayProjectTitle(project)}`;
        case "access.visibility_changed":
            return `${actorLabel(input)} changed project visibility`;
        case "access.public_tabs_changed":
            return `${actorLabel(input)} changed public project surfaces`;
        case "access.file_upload_permission_changed":
            return `${actorLabel(input)} changed your file upload access`;
        case "sprints.created":
            return `${actorLabel(input)} created a sprint`;
        case "sprints.started":
            return `${actorLabel(input)} started a sprint`;
        case "sprints.updated":
            return `${actorLabel(input)} updated a sprint`;
        case "sprints.completed":
            return `${actorLabel(input)} completed a sprint`;
        case "sprints.deleted":
            return `${actorLabel(input)} deleted a sprint`;
        case "sprints.task_moved":
            return `${actorLabel(input)} moved a task in the sprint plan`;
        case "files.uploaded":
        case "files.bulk_uploaded":
            return `${actorLabel(input)} uploaded project files`;
        case "files.folder_created":
            return `${actorLabel(input)} created a project folder`;
        case "files.organized":
            return `${actorLabel(input)} organized project files`;
        case "files.deleted_restored":
            return `${actorLabel(input)} changed project file availability`;
        case "files.git_sync_status":
            return `${actorLabel(input)} updated project sync status`;
        case "security.protected_action":
            return "Protected project action needs attention";
        case "security.data_export_ready":
            return "Project data export is ready";
        case "security.project_archived":
            return `${actorLabel(input)} archived ${displayProjectTitle(project)}`;
        case "security.delete_scheduled":
            return `${actorLabel(input)} scheduled project deletion`;
        default:
            return `${actorLabel(input)}: ${entry.label}`;
    }
}

function defaultHref(input: EnqueueProjectNotificationEventInput, project: ProjectRow) {
    if (input.href !== undefined) return input.href;
    const slugOrId = project.slug || project.id;
    switch (PROJECT_NOTIFICATION_EVENT_REGISTRY[input.eventKey].group) {
        case "files_workspace":
            return `/projects/${encodeURIComponent(slugOrId)}?tab=files`;
        case "project_lifecycle":
            return `/projects/${encodeURIComponent(slugOrId)}?tab=sprints`;
        case "tasks_workflow":
            return `/projects/${encodeURIComponent(slugOrId)}?tab=tasks`;
        case "roles_applications":
            return `/projects/${encodeURIComponent(slugOrId)}?tab=settings&settings=roles-applications`;
        default:
            return `/projects/${encodeURIComponent(slugOrId)}?tab=settings`;
    }
}

function previewFor(input: EnqueueProjectNotificationEventInput, project: ProjectRow): NotificationPreview | null {
    if (input.preview) return input.preview;
    return {
        actorName: input.actorName ?? null,
        actorAvatarUrl: input.actorAvatarUrl ?? null,
        contextLabel: displayProjectTitle(project),
        contextKind: "project",
        secondaryText: PROJECT_NOTIFICATION_EVENT_REGISTRY[input.eventKey].label,
    };
}

function uniqueIds(values: Array<string | null | undefined>) {
    return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function addGroupRecipients(params: {
    ids: Set<string>;
    group: ProjectNotificationRecipientGroup;
    project: ProjectRow;
    members: MemberRow[];
    input: ProjectNotificationRecipientContext;
}) {
    const { ids, group, project, members, input } = params;
    switch (group) {
        case "owner":
            ids.add(project.ownerId);
            return;
        case "co_leaders":
            members.filter((member) => member.role === "admin").forEach((member) => ids.add(member.userId));
            return;
        case "members":
            ids.add(project.ownerId);
            members.forEach((member) => ids.add(member.userId));
            return;
        case "viewers":
            members.filter((member) => member.role === "viewer").forEach((member) => ids.add(member.userId));
            return;
        case "affected_member":
            if (input.affectedMemberId) ids.add(input.affectedMemberId);
            return;
        case "assignee":
            if (input.assigneeId) ids.add(input.assigneeId);
            return;
        case "creator":
            if (input.creatorId) ids.add(input.creatorId);
            return;
        case "reviewer":
            uniqueIds(input.reviewerIds ?? []).forEach((id) => ids.add(id));
            return;
        case "applicant":
            if (input.applicantId) ids.add(input.applicantId);
            return;
        case "task_participants":
            uniqueIds(input.taskParticipantIds ?? []).forEach((id) => ids.add(id));
            return;
        case "followers":
            // Followers are loaded separately because they are not project members.
            return;
    }
}

function bucketForAggregate(eventKey: ProjectNotificationEventKey, now = new Date()) {
    const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[eventKey];
    if (entry.aggregate !== "burst_10m") return null;
    return Math.floor(now.getTime() / (10 * 60 * 1000)).toString(36);
}

function dedupeKeyFor(input: EnqueueProjectNotificationEventInput, recipientUserId: string) {
    const bucket = bucketForAggregate(input.eventKey);
    const source = bucket
        ? `burst:${bucket}`
        : input.sourceEventId ?? input.entityRefs?.fileId ?? input.entityRefs?.taskId ?? input.entityRefs?.applicationId ?? input.entityRefs?.workflowItemId ?? "latest";
    return `project:${input.projectId}:${input.eventKey}:${source}:${recipientUserId}`;
}

export async function resolveProjectNotificationRecipients(params: {
    projectId: string;
    eventKey: ProjectNotificationEventKey;
    input?: ProjectNotificationRecipientContext;
}) {
    const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[params.eventKey];
    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            title: projects.title,
            slug: projects.slug,
            visibility: projects.visibility,
            notificationPreferences: projects.notificationPreferences,
        })
        .from(projects)
        .where(and(eq(projects.id, params.projectId), isNull(projects.deletedAt)))
        .limit(1);
    if (!project) return { project: null, members: [] as MemberRow[], recipientIds: [] as string[] };

    const members = await db
        .select({
            userId: projectMembers.userId,
            role: projectMembers.role,
            notificationPreferences: projectMembers.notificationPreferences,
        })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, params.projectId));

    const ids = new Set<string>();
    const input = params.input ?? {};
    for (const group of entry.defaultRecipients) {
        addGroupRecipients({ ids, group, project, members, input });
    }
    uniqueIds(input.directRecipientIds ?? []).forEach((id) => ids.add(id));

    if (entry.defaultRecipients.includes("followers") && project.visibility === "public") {
        const followers = await db
            .select({ userId: projectFollows.userId })
            .from(projectFollows)
            .where(eq(projectFollows.projectId, params.projectId));
        followers.forEach((follower) => ids.add(follower.userId));
    }

    return { project, members, recipientIds: Array.from(ids) };
}

export async function enqueueProjectNotificationEvent(input: EnqueueProjectNotificationEventInput) {
    const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[input.eventKey];
    const { project, members, recipientIds } = await resolveProjectNotificationRecipients({
        projectId: input.projectId,
        eventKey: input.eventKey,
        input,
    });
    if (!project || recipientIds.length === 0) return { enqueued: 0 };

    const actorId = input.actorUserId ?? null;
    const projectPolicy = normalizeProjectNotificationPolicy(project.notificationPreferences);
    const overridesByUser = new Map<string, ProjectMemberNotificationOverrides>();
    members.forEach((member) => {
        overridesByUser.set(member.userId, normalizeProjectMemberNotificationOverrides(member.notificationPreferences));
    });

    const writes: NotificationFanoutWrite[] = [];
    // Ownership transfer is the one project event where the actor is also an
    // affected recipient: the previous owner needs the durable audit notice.
    const canNotifyActor =
        input.includeActorRecipient === true &&
        input.eventKey === "members.ownership_transferred";
    for (const recipientUserId of recipientIds) {
        if (!recipientUserId || (recipientUserId === actorId && !canNotifyActor)) continue;
        const decision = resolveProjectNotificationDecision({
            eventKey: input.eventKey,
            projectPolicy,
            memberOverrides: overridesByUser.get(recipientUserId) ?? null,
        });
        if (!decision.enabled) continue;
        writes.push({
            operation: entry.aggregate === "burst_10m" ? "aggregate" : "create",
            input: {
                recipientUserId,
                actorUserId: actorId,
                kind: entry.notificationKind,
                category: entry.category,
                importance: decision.rule.importance,
                title: titleFor(input, project),
                body: input.body ?? entry.description,
                href: defaultHref(input, project),
                entityRefs: {
                    ...(input.entityRefs ?? {}),
                    projectId: project.id,
                    projectSlug: project.slug ?? null,
                },
                preview: previewFor(input, project),
                dedupeKey: dedupeKeyFor(input, recipientUserId),
                aggregateCount: input.aggregateCount ?? 1,
            },
        });
    }

    if (writes.length === 0) return { enqueued: 0 };
    const result = await emitNotificationWrites(writes);
    if ("error" in result && result.error) {
        logger.warn("project_notifications.enqueue_failed", {
            module: "notifications",
            projectId: input.projectId,
            eventKey: input.eventKey,
            error: result.error,
        });
    }
    return result;
}

export async function readProjectNotificationActorSnapshot(userId: string | null | undefined) {
    if (!userId) return { actorName: null, actorAvatarUrl: null };
    const [profile] = await db
        .select({
            fullName: profiles.fullName,
            username: profiles.username,
            avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
    return {
        actorName: profile?.fullName || profile?.username || null,
        actorAvatarUrl: profile?.avatarUrl ?? null,
    };
}
