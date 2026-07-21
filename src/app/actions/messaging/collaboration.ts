'use server';

import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { isUuid } from '@/lib/validations/uuid';
import { db } from '@/lib/db';
import {
    conversationParticipants,
    conversations,
    messageWorkflowItems,
    messageWorkLinks,
    messages,
    profiles,
    projectMembers,
    projectNodes,
    projectOpenRoles,
    projects,
    tasks,
    roleApplications,
} from '@/lib/db/schema';
import type { MessageWithSender } from './_all';
import { getMessageContext, getOrCreateDMConversation } from './_all';
import {
    createPendingStructuredState,
    createStructuredMessagePayload,
    getMessagePreviewText,
    getStructuredMessageFromMetadata,
    getStructuredWorkflowActorRole,
    resolveStructuredWorkflowTransition,
    type MessageContextChip,
    type MessageWorkflowItemKind,
    type StructuredMessagePayload,
    type WorkflowResolutionAction,
    withStructuredMessageMetadata,
} from '@/lib/messages/structured';
import { refreshConversationParticipantPreviewsIfNeeded } from '@/lib/messages/preview-refresh';
import { withDeliveryMetadata } from '@/lib/messages/delivery-state';
import { emitWorkflowAssignedNotification, emitWorkflowResolvedNotification } from '@/lib/notifications/emitters';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import {
    isMessagingActivityBridgesEnabled,
    isMessagingPrivateFollowUpsEnabled,
    isMessagingStructuredActionsEnabled,
} from '@/lib/features/messages';
import { logger } from '@/lib/logger';
import { buildMessageSourceHref, mapWorkflowStatusToLinkStatus, upsertMessageWorkLink } from '@/lib/messages/linked-work-server';
import { mapMessageWorkLinkToSummary, type MessageLinkedWorkSummary } from '@/lib/messages/linked-work';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import {
    addProjectMemberInternal,
    isProjectMemberEligibleFor,
    requireProjectCapability,
} from '@/lib/projects/collaborator-lifecycle';
import { revalidatePath } from 'next/cache';

type StructuredComposerKind =
    | 'project_invite'
    | 'feedback_request'
    | 'availability_request'
    | 'task_approval'
    | 'rate_share'
    | 'handoff_summary';

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function readActorNotificationSnapshot(user: { id?: string | null; user_metadata?: Record<string, unknown> | null }) {
    const fallback = actorNotificationSnapshot(user);
    if (!user.id) return fallback;
    try {
        const [profile] = await db
            .select({
                fullName: profiles.fullName,
                username: profiles.username,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(eq(profiles.id, user.id))
            .limit(1);
        return {
            actorName: profile?.fullName || profile?.username || fallback.actorName,
            actorAvatarUrl: profile?.avatarUrl ?? fallback.actorAvatarUrl,
        };
    } catch (error) {
        logger.warn("messages.actor_notification_snapshot_failed", {
            module: "messaging",
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return fallback;
    }
}

function projectTaskHref(projectSlugOrId: string, taskId: string) {
    return `/projects/${encodeURIComponent(projectSlugOrId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function workflowKindLabel(kind: string | null | undefined) {
    const labels: Record<string, string> = {
        project_invite: 'project invite',
        feedback_request: 'feedback request',
        availability_request: 'availability request',
        task_approval: 'task approval',
        follow_up: 'follow-up',
    };
    return labels[kind ?? ''] ?? (kind ?? 'workflow').replace(/_/g, ' ');
}

async function resolveConversationId(params: {
    conversationId?: string | null;
    targetUserId?: string | null;
}) {
    let conversationId = params.conversationId ?? null;
    let targetUserId = params.targetUserId ?? null;

    // Handle draft conversation IDs — extract targetUserId and create the real conversation
    if (conversationId && conversationId.startsWith('draft:')) {
        targetUserId = targetUserId || conversationId.slice('draft:'.length);
        conversationId = null;
    }

    if (conversationId) {
        return conversationId;
    }

    if (!targetUserId) {
        throw new Error('Missing conversation target');
    }

    const ensured = await getOrCreateDMConversation(targetUserId);
    if (!ensured.success || !ensured.conversationId) {
        throw new Error(ensured.error || 'Failed to open conversation');
    }

    return ensured.conversationId;
}

async function requireConversationAccess(conversationId: string, userId: string) {
    const [membership] = await db
        .select({
            id: conversationParticipants.id,
        })
        .from(conversationParticipants)
        .where(
            and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, userId),
            ),
        )
        .limit(1);

    if (!membership) {
        throw new Error('Not authorized for this conversation');
    }

    return membership;
}

function parseValidDate(input?: string | null) {
    if (!input || input.trim() === '') {
        return null;
    }

    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDueDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
}

type MessageTaskPriority = 'low' | 'medium' | 'high' | 'urgent';

const MESSAGE_TASK_PRIORITIES = new Set<MessageTaskPriority>(['low', 'medium', 'high', 'urgent']);
function normalizeMessageTaskPriority(priority: unknown): MessageTaskPriority {
    return typeof priority === 'string' && MESSAGE_TASK_PRIORITIES.has(priority as MessageTaskPriority)
        ? priority as MessageTaskPriority
        : 'medium';
}

async function getConversationParticipantProfile(conversationId: string, profileId: string) {
    const [participant] = await db
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(conversationParticipants)
        .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
        .where(
            and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, profileId),
            ),
        )
        .limit(1);

    return participant ?? null;
}

async function getDirectConversationOtherParticipant(conversationId: string, userId: string) {
    const [conversation] = await db
        .select({ type: conversations.type })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

    if (!conversation) {
        throw new Error('Conversation not found');
    }

    if (conversation.type !== 'dm') {
        throw new Error('This action is only available in direct messages');
    }

    const [other] = await db
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(conversationParticipants)
        .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
        .where(
            and(
                eq(conversationParticipants.conversationId, conversationId),
                ne(conversationParticipants.userId, userId),
            ),
        )
        .limit(1);

    if (!other) {
        throw new Error('Conversation participant not found');
    }

    return other;
}

function normalizeChips(chips: MessageContextChip[] | undefined) {
    return Array.isArray(chips) ? chips.slice(0, 6) : [];
}

function buildPendingState(label: string) {
    return createPendingStructuredState(label);
}

function buildStructuredPayload(input: {
    kind: StructuredComposerKind | 'activity_bridge';
    title: string;
    summary: string;
    contextChips?: MessageContextChip[];
    workflowItemId?: string | null;
    stateSnapshot?: StructuredMessagePayload['stateSnapshot'];
    entityRefs?: StructuredMessagePayload['entityRefs'];
    payload?: Record<string, unknown> | null;
}): StructuredMessagePayload {
    const payload = createStructuredMessagePayload({
        ...input,
        contextChips: normalizeChips(input.contextChips),
    });
    if (!payload) {
        throw new Error('Structured message payload requires a non-empty title and summary');
    }
    return payload;
}

async function hydrateSingleMessage(conversationId: string, messageId: string) {
    const context = await getMessageContext(conversationId, messageId);
    return context.success && context.available && context.message ? context.message : null;
}

async function emitActivityBridgeMessage(params: {
    conversationId: string;
    senderId: string;
    title: string;
    summary: string;
    contextChips?: MessageContextChip[];
    entityRefs?: StructuredMessagePayload['entityRefs'];
}) {
    if (!isMessagingActivityBridgesEnabled(params.senderId)) {
        return null;
    }

    const payload = buildStructuredPayload({
        kind: 'activity_bridge',
        title: params.title,
        summary: params.summary,
        contextChips: params.contextChips,
        entityRefs: params.entityRefs,
        stateSnapshot: { status: 'shared', label: 'Updated' },
    });

    const [messageRow] = await db
        .insert(messages)
        .values({
            conversationId: params.conversationId,
            senderId: params.senderId,
            type: 'system',
            content: null,
            metadata: withDeliveryMetadata(withStructuredMessageMetadata({ version: 4 }, payload), 'sent'),
        })
        .returning({ id: messages.id });

    return messageRow?.id ? hydrateSingleMessage(params.conversationId, messageRow.id) : null;
}

export interface MessagingStructuredCatalogV2 {
    linkedProjectId: string | null;
    projects: Array<{
        id: string;
        title: string;
        slug: string | null;
        role: 'owner' | 'admin' | 'member' | 'viewer';
    }>;
    tasks: Array<{
        id: string;
        title: string;
        taskNumber: number;
        projectId: string;
    }>;
    files: Array<{
        id: string;
        name: string;
        path: string;
        projectId: string;
    }>;
    profiles: Array<{
        id: string;
        label: string;
        subtitle: string | null;
    }>;
}

export async function getMessagingStructuredCatalogV2(params: {
    conversationId?: string | null;
    targetUserId?: string | null;
}): Promise<{ success: boolean; error?: string; catalog?: MessagingStructuredCatalogV2 }> {
    try {
        const user = await getAuthUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }
        if (!isMessagingStructuredActionsEnabled(user.id)) {
            return { success: false, error: 'Structured actions are unavailable' };
        }

        const conversationId = await resolveConversationId(params);
        await requireConversationAccess(conversationId, user.id);

        const [linkedProject, projectMemberships, participantProfiles] = await Promise.all([
            db
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.conversationId, conversationId))
                .limit(1),
            db
                .select({
                    id: projects.id,
                    title: projects.title,
                    slug: projects.slug,
                    role: projectMembers.role,
                })
                .from(projectMembers)
                .innerJoin(projects, eq(projects.id, projectMembers.projectId))
                .where(
                    and(
                        eq(projectMembers.userId, user.id),
                        isNull(projects.deletedAt),
                    ),
                )
                .orderBy(desc(projects.updatedAt))
                .limit(20),
            db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                })
                .from(conversationParticipants)
                .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
                .where(eq(conversationParticipants.conversationId, conversationId)),
        ]);

        const linkedProjectId = linkedProject[0]?.id ?? null;
        const projectScopeIds = linkedProjectId
            ? [linkedProjectId]
            : projectMemberships.slice(0, 5).map((membership) => membership.id);

        const [taskRows, fileRows] = projectScopeIds.length > 0
            ? await Promise.all([
                db
                    .select({
                        id: tasks.id,
                        title: tasks.title,
                        taskNumber: tasks.taskNumber,
                        projectId: tasks.projectId,
                    })
                    .from(tasks)
                    .where(
                        and(
                            inArray(tasks.projectId, projectScopeIds),
                            isNull(tasks.deletedAt),
                        ),
                    )
                    .orderBy(desc(tasks.updatedAt))
                    .limit(30),
                db
                    .select({
                        id: projectNodes.id,
                        name: projectNodes.name,
                        path: projectNodes.path,
                        projectId: projectNodes.projectId,
                    })
                    .from(projectNodes)
                    .where(
                        and(
                            inArray(projectNodes.projectId, projectScopeIds),
                            eq(projectNodes.type, 'file'),
                            isNull(projectNodes.deletedAt),
                        ),
                    )
                    .orderBy(desc(projectNodes.updatedAt))
                    .limit(30),
            ])
            : [[], []];

        return {
            success: true,
            catalog: {
                linkedProjectId,
                projects: projectMemberships.map((membership) => ({
                    id: membership.id,
                    title: membership.title,
                    slug: membership.slug,
                    role: membership.role,
                })),
                tasks: taskRows.map((task) => ({
                    id: task.id,
                    title: task.title,
                    taskNumber: task.taskNumber ?? 0,
                    projectId: task.projectId,
                })),
                files: fileRows.map((file) => ({
                    id: file.id,
                    name: file.name,
                    path: file.path,
                    projectId: file.projectId,
                })),
                profiles: participantProfiles
                    .filter((profile) => profile.id !== user.id)
                    .map((profile) => ({
                        id: profile.id,
                        label: profile.fullName || profile.username || 'User',
                        subtitle: profile.username ? `@${profile.username}` : null,
                    })),
            },
        };
    } catch (error) {
        logger.error('[messages.collaboration] failed to load structured catalog', {
            module: 'messaging',
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: error instanceof Error ? error.message : 'Failed to load commands' };
    }
}

function toProjectChip(project: { id: string; title: string; slug: string | null }): MessageContextChip {
    return {
        kind: 'project',
        id: project.id,
        label: project.title,
        subtitle: project.slug ? `/${project.slug}` : null,
    };
}

function toTaskChip(task: { id: string; title: string; taskNumber: number }): MessageContextChip {
    return {
        kind: 'task',
        id: task.id,
        label: `#${task.taskNumber} ${task.title}`,
        subtitle: null,
    };
}

export async function sendStructuredMessageActionV2(params: {
    conversationId?: string | null;
    targetUserId?: string | null;
    kind: StructuredComposerKind;
    title?: string | null;
    summary: string;
    note?: string | null;
    projectId?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    taskId?: string | null;
    fileId?: string | null;
    profileId?: string | null;
    amount?: string | null;
    unit?: string | null;
    dueAt?: string | null;
    completed?: string | null;
    blocked?: string | null;
    next?: string | null;
    contextChips?: MessageContextChip[];
    clientMessageId?: string | null;
}): Promise<{ success: boolean; error?: string; conversationId?: string; message?: MessageWithSender }> {
    try {
        const user = await getAuthUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }
        if (!isMessagingStructuredActionsEnabled(user.id)) {
            return { success: false, error: 'Structured actions are unavailable' };
        }

        const conversationId = await resolveConversationId(params);
        await requireConversationAccess(conversationId, user.id);
        const otherParticipant = await getDirectConversationOtherParticipant(conversationId, user.id).catch(() => null);
        const requestedProfileId = params.profileId?.trim() || null;
        const resolveAssignee = async (fallbackProfileId?: string | null) => {
            const candidateProfileId = requestedProfileId || fallbackProfileId || null;
            if (!candidateProfileId) {
                return null;
            }
            if (candidateProfileId === user.id) {
                throw new Error('Choose another participant for this action');
            }
            return getConversationParticipantProfile(conversationId, candidateProfileId);
        };

        const dueAt = parseValidDate(params.dueAt);
        if (params.dueAt && !dueAt) {
            throw new Error('Invalid due date');
        }

        let workflowKind: MessageWorkflowItemKind | null = null;
        let structured: StructuredMessagePayload;

        if (params.kind === 'project_invite') {
            if (!params.projectId) throw new Error('Select a project to invite into');
            const [project] = await db
                .select({
                    id: projects.id,
                    title: projects.title,
                    slug: projects.slug,
                    role: projectMembers.role,
                })
                .from(projectMembers)
                .innerJoin(projects, eq(projects.id, projectMembers.projectId))
                .where(
                    and(
                        eq(projectMembers.projectId, params.projectId),
                        eq(projectMembers.userId, user.id),
                        or(eq(projectMembers.role, 'owner'), eq(projectMembers.role, 'admin')),
                    ),
                )
                .limit(1);
            if (!project) throw new Error('You can only invite to projects you manage');
            if (!otherParticipant) throw new Error('A direct recipient is required for project invites');

            // 1. Verify if user is already a member of the project
            const [existingMember] = await db
                .select({ id: projectMembers.id })
                .from(projectMembers)
                .where(and(
                    eq(projectMembers.projectId, params.projectId),
                    eq(projectMembers.userId, otherParticipant.id)
                ))
                .limit(1);
            if (existingMember) throw new Error('User is already a member of this project');

            // 2. Verify if user has a pending application for this project/role
            if (params.roleId) {
                const [existingApp] = await db
                    .select({ id: roleApplications.id })
                    .from(roleApplications)
                    .where(and(
                        eq(roleApplications.projectId, params.projectId),
                        eq(roleApplications.applicantId, otherParticipant.id),
                        eq(roleApplications.roleId, params.roleId),
                        eq(roleApplications.status, 'pending')
                    ))
                    .limit(1);
                if (existingApp) throw new Error('User has already applied for this role');
            }

            // 3. Verify if user has a pending invitation for this project/role
            const activeInvites = await db
                .select()
                .from(messageWorkflowItems)
                .where(and(
                    eq(messageWorkflowItems.projectId, params.projectId),
                    eq(messageWorkflowItems.assigneeUserId, otherParticipant.id),
                    eq(messageWorkflowItems.status, 'pending'),
                    eq(messageWorkflowItems.kind, 'project_invite')
                ));
            const duplicateInvite = activeInvites.find((invite) => {
                const payload = invite.payload as Record<string, unknown> | null;
                return payload?.roleId === params.roleId;
            });
            if (duplicateInvite) throw new Error('An invitation for this role is already active');
            
            let inviteRoleTitle = params.roleTitle || 'Team Member';
            if (params.roleId) {
                const roleRow = await db.query.projectOpenRoles.findFirst({
                    where: and(
                        eq(projectOpenRoles.id, params.roleId),
                        eq(projectOpenRoles.projectId, params.projectId)
                    ),
                });
                if (roleRow) {
                    inviteRoleTitle = roleRow.title || roleRow.role || 'Team Member';
                }
            }

            workflowKind = 'project_invite';
            structured = buildStructuredPayload({
                kind: 'project_invite',
                title: params.title?.trim() || 'Project invite',
                summary: params.summary.trim() || `Invitation to join ${project.title}`,
                contextChips: [...normalizeChips(params.contextChips), toProjectChip(project)],
                entityRefs: { projectId: project.id, profileId: otherParticipant.id },
                stateSnapshot: buildPendingState('Pending'),
                payload: {
                    note: params.note?.trim() || null,
                    projectTitle: project.title,
                    projectSlug: project.slug,
                    roleId: params.roleId || null,
                    roleTitle: inviteRoleTitle,
                },
            });
        } else if (params.kind === 'feedback_request') {
            const assignee = await resolveAssignee(otherParticipant?.id ?? null);
            if (!assignee) throw new Error('Select who should respond to this feedback request');
            workflowKind = 'feedback_request';
            structured = buildStructuredPayload({
                kind: 'feedback_request',
                title: params.title?.trim() || 'Feedback request',
                summary: params.summary.trim(),
                contextChips: normalizeChips(params.contextChips),
                entityRefs: {
                    projectId: params.projectId ?? null,
                    taskId: params.taskId ?? null,
                    fileId: params.fileId ?? null,
                    profileId: assignee.id,
                },
                stateSnapshot: buildPendingState('Pending'),
                payload: {
                    note: params.note?.trim() || null,
                    dueAt: params.dueAt || null,
                },
            });
        } else if (params.kind === 'availability_request') {
            if (!otherParticipant) throw new Error('A direct recipient is required for availability checks');
            workflowKind = 'availability_request';
            structured = buildStructuredPayload({
                kind: 'availability_request',
                title: params.title?.trim() || 'Availability check',
                summary: params.summary.trim(),
                contextChips: normalizeChips(params.contextChips),
                entityRefs: {
                    projectId: params.projectId ?? null,
                    taskId: params.taskId ?? null,
                    profileId: otherParticipant.id,
                },
                stateSnapshot: buildPendingState('Pending'),
                payload: {
                    note: params.note?.trim() || null,
                },
            });
        } else if (params.kind === 'task_approval') {
            if (!params.taskId) throw new Error('Select a task to approve');
            const assignee = await resolveAssignee(otherParticipant?.id ?? null);
            if (!assignee) throw new Error('Select who should review this task approval');
            const [task] = await db
                .select({
                    id: tasks.id,
                    title: tasks.title,
                    taskNumber: tasks.taskNumber,
                    projectId: tasks.projectId,
                })
                .from(tasks)
                .innerJoin(projectMembers, and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, user.id)))
                .where(and(eq(tasks.id, params.taskId), isNull(tasks.deletedAt)))
                .limit(1);
            if (!task) throw new Error('Task not found or inaccessible');
            workflowKind = 'task_approval';
            structured = buildStructuredPayload({
                kind: 'task_approval',
                title: params.title?.trim() || 'Task approval',
                summary: params.summary.trim() || `Approval requested for ${task.title}`,
                contextChips: [...normalizeChips(params.contextChips), toTaskChip({
                    id: task.id,
                    title: task.title,
                    taskNumber: task.taskNumber ?? 0,
                })],
                entityRefs: {
                    projectId: task.projectId,
                    taskId: task.id,
                    profileId: assignee.id,
                },
                stateSnapshot: buildPendingState('Pending'),
                payload: {
                    note: params.note?.trim() || null,
                },
            });
        } else if (params.kind === 'rate_share') {
            const amount = params.amount?.trim();
            const unit = params.unit?.trim();
            if (!amount || !unit) throw new Error('Enter a rate amount and unit');
            structured = buildStructuredPayload({
                kind: 'rate_share',
                title: params.title?.trim() || 'Rate',
                summary: params.summary.trim() || `${amount} / ${unit}`,
                contextChips: normalizeChips(params.contextChips),
                entityRefs: { projectId: params.projectId ?? null },
                stateSnapshot: { status: 'shared', label: 'Shared' },
                payload: {
                    amount,
                    unit,
                    note: params.note?.trim() || null,
                },
            });
        } else {
            structured = buildStructuredPayload({
                kind: 'handoff_summary',
                title: params.title?.trim() || 'Handoff summary',
                summary: params.summary.trim(),
                contextChips: normalizeChips(params.contextChips),
                entityRefs: {
                    projectId: params.projectId ?? null,
                    taskId: params.taskId ?? null,
                    fileId: params.fileId ?? null,
                    profileId: params.profileId ?? null,
                },
                stateSnapshot: { status: 'shared', label: 'Shared' },
                payload: {
                    completed: params.completed?.trim() || null,
                    blocked: params.blocked?.trim() || null,
                    next: params.next?.trim() || null,
                    note: params.note?.trim() || null,
                },
            });
        }

        const result = await db.transaction(async (tx) => {
            const [messageRow] = await tx
                .insert(messages)
                .values({
                    conversationId,
                    senderId: user.id,
                    clientMessageId: params.clientMessageId?.trim() || null,
                    content: null,
                    type: 'text',
                    metadata: withDeliveryMetadata(withStructuredMessageMetadata({
                        version: 4,
                        ...(params.clientMessageId ? { clientMessageId: params.clientMessageId } : {}),
                    }, structured), 'sent'),
                })
                .returning({ id: messages.id });

            let workflowItemId: string | null = null;
            if (workflowKind) {
                const [workflowRow] = await tx
                    .insert(messageWorkflowItems)
                    .values({
                        messageId: messageRow!.id,
                        conversationId,
                        kind: workflowKind,
                        scope: 'conversation',
                        creatorId: user.id,
                        assigneeUserId: structured.entityRefs.profileId ?? null,
                        projectId: structured.entityRefs.projectId ?? null,
                        taskId: structured.entityRefs.taskId ?? null,
                        status: 'pending',
                        payload: structured.payload || {},
                        dueAt,
                    })
                    .returning({ id: messageWorkflowItems.id });
                workflowItemId = workflowRow?.id ?? null;
                if (workflowRow?.id) {
                    await upsertMessageWorkLink(tx, {
                        sourceMessageId: messageRow!.id,
                        sourceConversationId: conversationId,
                        targetType: 'workflow',
                        targetId: workflowRow.id,
                        targetProjectId: structured.entityRefs.projectId ?? null,
                        visibility: 'shared',
                        status: 'pending',
                        ownerUserId: user.id,
                        assigneeUserId: structured.entityRefs.profileId ?? null,
                        createdBy: user.id,
                        href: buildMessageSourceHref(conversationId, messageRow!.id),
                        metadata: {
                            label: structured.title,
                            subtitle: structured.summary,
                            title: structured.title,
                            workflowKind,
                            workflowLabel: structured.title,
                            projectId: structured.entityRefs.projectId ?? null,
                            taskId: structured.entityRefs.taskId ?? null,
                        },
                    });
                }
            }

            if (workflowItemId) {
                const nextStructured = {
                    ...structured,
                    workflowItemId,
                } satisfies StructuredMessagePayload;
                await tx
                    .update(messages)
                    .set({
                        metadata: withDeliveryMetadata(withStructuredMessageMetadata({
                            version: 4,
                            ...(params.clientMessageId ? { clientMessageId: params.clientMessageId } : {}),
                        }, nextStructured), 'sent'),
                    })
                    .where(eq(messages.id, messageRow!.id));
            }

            return { messageId: messageRow!.id, workflowItemId };
        });

        if (result.workflowItemId && structured.entityRefs.profileId) {
            const [projectRow] = structured.entityRefs.projectId
                ? await db
                    .select({
                        id: projects.id,
                        slug: projects.slug,
                        title: projects.title,
                    })
                    .from(projects)
                    .where(eq(projects.id, structured.entityRefs.projectId))
                    .limit(1)
                : [null];

            try {
                const actor = await readActorNotificationSnapshot(user);
                if (structured.entityRefs.projectId) {
                    const kindLabel = workflowKindLabel(workflowKind);
                    await enqueueProjectNotificationEvent({
                        projectId: structured.entityRefs.projectId,
                        actorUserId: user.id,
                        ...actor,
                        eventKey: "workflows.assigned",
                        affectedMemberId: structured.entityRefs.profileId,
                        title: workflowKind === "project_invite"
                            ? `${actor.actorName || "Someone"} invited you to ${projectRow?.title || "a project"}`
                            : `${actor.actorName || "Someone"} assigned you a ${kindLabel}`,
                        body: projectRow?.title ? `Project: ${projectRow.title}` : null,
                        href: `/messages?conversationId=${encodeURIComponent(conversationId)}`,
                        entityRefs: {
                            workflowItemId: result.workflowItemId,
                            conversationId,
                            projectId: structured.entityRefs.projectId,
                            projectSlug: projectRow?.slug ?? null,
                            taskId: structured.entityRefs.taskId ?? null,
                        },
                        preview: {
                            actorName: actor.actorName,
                            actorAvatarUrl: actor.actorAvatarUrl,
                            contextLabel: projectRow?.title ?? "Workflow",
                            contextKind: "workflow",
                            secondaryText: kindLabel,
                        },
                        sourceEventId: result.workflowItemId,
                    });
                } else {
                    await emitWorkflowAssignedNotification({
                        recipientUserId: structured.entityRefs.profileId,
                        actorUserId: user.id,
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        workflowItemId: result.workflowItemId,
                        workflowKind: workflowKind ?? "follow_up",
                        conversationId,
                        projectId: structured.entityRefs.projectId ?? null,
                        projectSlug: projectRow?.slug ?? null,
                        projectTitle: projectRow?.title ?? null,
                        taskId: structured.entityRefs.taskId ?? null,
                    });
                }
            } catch (notificationError) {
                logger.warn("messages.workflow_assigned_notification_failed", {
                    module: "messaging",
                    conversationId,
                    workflowItemId: result.workflowItemId,
                    recipientUserId: structured.entityRefs.profileId,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }

        const message = await hydrateSingleMessage(conversationId, result.messageId);
        return {
            success: Boolean(message),
            error: message ? undefined : 'Failed to send structured message',
            conversationId,
            message: message ?? undefined,
        };
    } catch (error) {
        logger.error('[messages.collaboration] failed to send structured message', {
            module: 'messaging',
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: error instanceof Error ? error.message : 'Failed to send structured message' };
    }
}

export async function resolveMessageWorkflowActionV2(params: {
    workflowItemId: string;
    action: WorkflowResolutionAction;
    note?: string | null;
}): Promise<{ success: boolean; error?: string; conversationId?: string; message?: MessageWithSender; bridgeMessage?: MessageWithSender | null }> {
    try {
        const user = await getAuthUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }
        if (!isMessagingStructuredActionsEnabled(user.id)) {
            return { success: false, error: 'Structured actions are unavailable' };
        }

        const [workflow] = await db
            .select({
                id: messageWorkflowItems.id,
                messageId: messageWorkflowItems.messageId,
                conversationId: messageWorkflowItems.conversationId,
                kind: messageWorkflowItems.kind,
                status: messageWorkflowItems.status,
                creatorId: messageWorkflowItems.creatorId,
                assigneeUserId: messageWorkflowItems.assigneeUserId,
                projectId: messageWorkflowItems.projectId,
                taskId: messageWorkflowItems.taskId,
                payload: messageWorkflowItems.payload,
                messageMetadata: messages.metadata,
            })
            .from(messageWorkflowItems)
            .leftJoin(messages, eq(messages.id, messageWorkflowItems.messageId))
            .where(eq(messageWorkflowItems.id, params.workflowItemId))
            .limit(1);

        if (!workflow || !workflow.messageId) {
            return { success: false, error: 'Workflow item not found' };
        }

        await requireConversationAccess(workflow.conversationId, user.id);

        if (workflow.creatorId !== user.id && workflow.assigneeUserId !== user.id) {
            return { success: false, error: 'Not authorized for this workflow' };
        }

        const currentStructured = getStructuredMessageFromMetadata(
            workflow.messageMetadata as Record<string, unknown> | null,
        );
        if (!currentStructured) {
            return { success: false, error: 'Structured message payload missing' };
        }
        if (currentStructured.workflowItemId && currentStructured.workflowItemId !== workflow.id) {
            return { success: false, error: 'Structured workflow is out of sync' };
        }

        const transition = resolveStructuredWorkflowTransition({
            kind: workflow.kind,
            currentStatus: workflow.status,
            action: params.action,
            currentUserId: user.id,
            creatorId: workflow.creatorId,
            assigneeUserId: workflow.assigneeUserId,
        });
        if (!transition) {
            const actorRole = getStructuredWorkflowActorRole({
                currentUserId: user.id,
                creatorId: workflow.creatorId,
                assigneeUserId: workflow.assigneeUserId,
            });
            if (workflow.status !== 'pending') {
                return { success: false, error: 'This workflow has already been resolved' };
            }
            if (actorRole !== 'assignee') {
                return { success: false, error: 'Only the requested participant can resolve this workflow' };
            }
            return { success: false, error: 'This action is not available for the current workflow' };
        }
        const nextStatus = transition.nextStatus;
        const nextLabel = transition.nextLabel;
        const bridgeConfig = transition.bridge;
        const resolvedAt = new Date();

        const memberJoinLifecycle = await db.transaction(async (tx) => {
            let lifecycle: Awaited<ReturnType<typeof addProjectMemberInternal>> | null = null;
            if (workflow.kind === 'project_invite' && params.action === 'accept' && workflow.projectId && workflow.assigneeUserId) {
                const roleId = (workflow.payload as any)?.roleId ?? null;
                lifecycle = await addProjectMemberInternal(tx, {
                    projectId: workflow.projectId,
                    userId: workflow.assigneeUserId,
                    role: 'member',
                    actorId: user.id,
                    source: 'project_invite',
                    syncGroupConversation: true,
                    roleId,
                    incrementRoleCapacity: !!roleId,
                });
            }

            await tx
                .update(messageWorkflowItems)
                .set({
                    status: nextStatus,
                    resolvedAt,
                    updatedAt: resolvedAt,
                    payload: {
                        ...((workflow.payload as Record<string, unknown>) || {}),
                        note: params.note?.trim() || null,
                        resolution: params.action,
                    },
                })
                .where(eq(messageWorkflowItems.id, workflow.id));

            await tx
                .update(messageWorkLinks)
                .set({
                    status: mapWorkflowStatusToLinkStatus(nextStatus),
                    updatedAt: resolvedAt,
                    metadata: {
                        ...((workflow.payload as Record<string, unknown>) || {}),
                        projectId: workflow.projectId,
                        taskId: workflow.taskId,
                        label: currentStructured.title,
                        subtitle: nextLabel,
                        workflowKind: workflow.kind,
                        workflowLabel: currentStructured.title,
                        resolution: params.action,
                        resolvedAt: resolvedAt.toISOString(),
                    },
                })
                .where(and(
                    eq(messageWorkLinks.targetType, 'workflow'),
                    eq(messageWorkLinks.targetId, workflow.id),
                    isNull(messageWorkLinks.deletedAt),
                ));

            const nextStructured = {
                ...currentStructured,
                stateSnapshot: {
                    status: nextStatus,
                    label: nextLabel,
                    note: params.note?.trim() || null,
                    actorId: user.id,
                    actorName: user.user_metadata?.full_name as string | undefined,
                    resolvedAt: resolvedAt.toISOString(),
                },
            } satisfies StructuredMessagePayload;

            await tx
                .update(messages)
                .set({
                    metadata: withDeliveryMetadata(withStructuredMessageMetadata(
                        (workflow.messageMetadata as Record<string, unknown>) || {},
                        nextStructured,
                    ), 'sent'),
                })
                .where(eq(messages.id, workflow.messageId!));

            return lifecycle;
        });

        if (memberJoinLifecycle?.changed && workflow.projectId && workflow.assigneeUserId) {
            try {
                const actor = await readActorNotificationSnapshot(user);
                const memberName = memberJoinLifecycle.target?.fullName || memberJoinLifecycle.target?.username || "A member";
                await enqueueProjectNotificationEvent({
                    projectId: workflow.projectId,
                    actorUserId: user.id,
                    ...actor,
                    eventKey: "members.joined",
                    title: `${memberName} joined ${memberJoinLifecycle.project.title || "the project"}`,
                    body: "Project invite accepted.",
                    href: `/projects/${encodeURIComponent(memberJoinLifecycle.project.slug || workflow.projectId)}?tab=settings&settings=collaborators`,
                    entityRefs: {
                        projectId: workflow.projectId,
                        projectSlug: memberJoinLifecycle.project.slug ?? null,
                        workflowItemId: workflow.id,
                        conversationId: workflow.conversationId,
                        targetUserId: workflow.assigneeUserId,
                    },
                    preview: {
                        actorName: memberName,
                        actorAvatarUrl: memberJoinLifecycle.target?.avatarUrl ?? null,
                        contextLabel: memberJoinLifecycle.project.title ?? "Project",
                        contextKind: "project",
                        secondaryText: "New project member",
                    },
                    sourceEventId: memberJoinLifecycle.eventId ?? `${workflow.id}:member-joined`,
                });
            } catch (notificationError) {
                logger.warn("messages.project_invite_member_joined_notification_failed", {
                    module: "messaging",
                    projectId: workflow.projectId,
                    workflowItemId: workflow.id,
                    targetUserId: workflow.assigneeUserId,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }

        if (workflow.assigneeUserId === user.id && workflow.creatorId !== user.id) {
            const [projectRow] = workflow.projectId
                ? await db
                    .select({
                        id: projects.id,
                        slug: projects.slug,
                        title: projects.title,
                    })
                    .from(projects)
                    .where(eq(projects.id, workflow.projectId))
                    .limit(1)
                : [null];

            try {
                const actor = await readActorNotificationSnapshot(user);
                if (workflow.projectId) {
                    await enqueueProjectNotificationEvent({
                        projectId: workflow.projectId,
                        actorUserId: user.id,
                        ...actor,
                        eventKey: "workflows.resolved",
                        affectedMemberId: workflow.creatorId,
                        title: `${actor.actorName || "Someone"} resolved your ${workflowKindLabel(workflow.kind)}`,
                        body: nextLabel,
                        href: `/messages?conversationId=${encodeURIComponent(workflow.conversationId)}`,
                        entityRefs: {
                            workflowItemId: workflow.id,
                            conversationId: workflow.conversationId,
                            projectId: workflow.projectId,
                            projectSlug: projectRow?.slug ?? null,
                            taskId: workflow.taskId ?? null,
                        },
                        preview: {
                            actorName: actor.actorName,
                            actorAvatarUrl: actor.actorAvatarUrl,
                            contextLabel: projectRow?.title ?? "Workflow",
                            contextKind: "workflow",
                            secondaryText: nextLabel,
                        },
                        sourceEventId: `${workflow.id}:resolved`,
                    });
                } else {
                    await emitWorkflowResolvedNotification({
                        recipientUserId: workflow.creatorId,
                        actorUserId: user.id,
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        workflowItemId: workflow.id,
                        workflowKind: workflow.kind,
                        resolutionLabel: nextLabel,
                        conversationId: workflow.conversationId,
                        projectId: workflow.projectId ?? null,
                        projectSlug: projectRow?.slug ?? null,
                        projectTitle: projectRow?.title ?? null,
                        taskId: workflow.taskId ?? null,
                    });
                }
            } catch (notificationError) {
                logger.warn("messages.workflow_resolved_notification_failed", {
                    module: "messaging",
                    conversationId: workflow.conversationId,
                    workflowItemId: workflow.id,
                    recipientUserId: workflow.creatorId,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }

        await refreshConversationParticipantPreviewsIfNeeded(workflow.conversationId, workflow.messageId);
        const bridgeMessage = bridgeConfig
            ? await emitActivityBridgeMessage({
                conversationId: workflow.conversationId,
                senderId: user.id,
                title: bridgeConfig.title,
                summary: bridgeConfig.summary,
                contextChips: currentStructured.contextChips,
                entityRefs: currentStructured.entityRefs,
            })
            : null;
        const message = await hydrateSingleMessage(workflow.conversationId, workflow.messageId);
        return {
            success: Boolean(message),
            error: message ? undefined : 'Failed to refresh workflow message',
            conversationId: workflow.conversationId,
            message: message ?? undefined,
            bridgeMessage,
        };
    } catch (error) {
        logger.error('[messages.collaboration] failed to resolve workflow', {
            module: 'messaging',
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: error instanceof Error ? error.message : 'Failed to resolve workflow' };
    }
}

export async function convertMessageToTaskActionV2(params: {
    messageId: string;
    projectId: string;
    title?: string | null;
    description?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    assigneeId?: string | null;
    dueDate?: string | null;
}): Promise<{ success: boolean; error?: string; conversationId?: string; taskId?: string; link?: MessageLinkedWorkSummary; bridgeMessage?: MessageWithSender | null }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [messageRow] = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                content: messages.content,
                metadata: messages.metadata,
            })
            .from(messages)
            .where(eq(messages.id, params.messageId))
            .limit(1);

        if (!messageRow) return { success: false, error: 'Message not found' };
        await requireConversationAccess(messageRow.conversationId, user.id);

        const dueDate = parseValidDate(params.dueDate);
        if (params.dueDate && !dueDate) {
            return { success: false, error: 'Invalid due date' };
        }

        const structured = getStructuredMessageFromMetadata(
            messageRow.metadata as Record<string, unknown> | null,
        );
        const sourceTitle = params.title?.trim()
            || structured?.title
            || messageRow.content?.trim()
            || 'Follow-up task';
        const sourceSummary = params.description?.trim()
            || structured?.summary
            || messageRow.content?.trim()
            || 'Created from a message';

        const taskTitle = sourceTitle.slice(0, 120).trim() || 'Follow-up task';
        const taskDescription = `${sourceSummary}\n\nSource conversation message: ${messageRow.id}`;
        const taskPriority = normalizeMessageTaskPriority(params.priority);
        const taskAssigneeId = params.assigneeId || null;

        if (!isUuid(params.projectId)) return { success: false, error: 'Invalid project id' };
        if (taskAssigneeId && !isUuid(taskAssigneeId)) {
            return { success: false, error: 'Invalid assignee id' };
        }

        try {
            await requireProjectCapability(params.projectId, user.id, 'create_tasks');
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            return { success: false, error: message === 'Project not found' ? message : 'You do not have permission to create tasks in this project' };
        }

        if (taskAssigneeId) {
            try {
                await requireProjectCapability(params.projectId, user.id, 'assign_tasks');
            } catch {
                return { success: false, error: 'You do not have permission to assign tasks in this project' };
            }
            const assigneeMember = await db.query.projectMembers.findFirst({
                where: and(
                    eq(projectMembers.projectId, params.projectId),
                    eq(projectMembers.userId, taskAssigneeId),
                ),
                columns: { id: true, role: true },
            });
            if (!assigneeMember) {
                return { success: false, error: 'Assignee must be a project member' };
            }
            if (!isProjectMemberEligibleFor(assigneeMember.role, 'assign')) {
                return { success: false, error: 'Assignee must be an assignable project member' };
            }
        }

        const sourcePreview = getMessagePreviewText({
            content: messageRow.content,
            type: structured?.kind || null,
            metadata: messageRow.metadata as Record<string, unknown> | null,
        });

        const taskResult = await db.transaction(async (tx) => {
            const projectRows = await tx.execute<{
                current_task_number: number | null;
                slug: string | null;
                title: string | null;
                key: string | null;
            }>(sql`
                SELECT current_task_number, slug, title, "key" AS key
                FROM ${projects}
                WHERE id = ${params.projectId}
                    AND deleted_at IS NULL
                FOR UPDATE
            `);
            const targetProject = Array.from(projectRows)[0];
            if (!targetProject) throw new Error('Project not found');

            const nextTaskNumber = Number(targetProject.current_task_number || 0) + 1;
            await tx
                .update(projects)
                .set({ currentTaskNumber: nextTaskNumber })
                .where(eq(projects.id, params.projectId));

            const [taskRow] = await tx
                .insert(tasks)
                .values({
                    projectId: params.projectId,
                    title: taskTitle,
                    description: taskDescription,
                    status: 'todo',
                    priority: taskPriority,
                    sprintId: null,
                    assigneeId: taskAssigneeId,
                    creatorId: user.id,
                    dueDate,
                    taskNumber: nextTaskNumber,
                })
                .returning({
                    id: tasks.id,
                    projectId: tasks.projectId,
                    title: tasks.title,
                    taskNumber: tasks.taskNumber,
                    createdAt: tasks.createdAt,
                    updatedAt: tasks.updatedAt,
                });

            if (!taskRow) throw new Error('Failed to create task');

            const taskHref = targetProject.slug
                ? `/projects/${encodeURIComponent(targetProject.slug)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskRow.id)}&panelTab=details`
                : `/projects/${encodeURIComponent(params.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskRow.id)}&panelTab=details`;

            const linkRow = await upsertMessageWorkLink(tx, {
                sourceMessageId: messageRow.id,
                sourceConversationId: messageRow.conversationId,
                targetType: 'task',
                targetId: taskRow.id,
                targetProjectId: params.projectId,
                visibility: 'shared',
                status: 'active',
                ownerUserId: user.id,
                assigneeUserId: taskAssigneeId,
                createdBy: user.id,
                href: taskHref,
                metadata: {
                    label: taskRow.taskNumber ? `Task #${taskRow.taskNumber}` : 'Task',
                    title: taskRow.title,
                    subtitle: targetProject.title ?? null,
                    taskNumber: taskRow.taskNumber ? `#${taskRow.taskNumber}` : null,
                    projectTitle: targetProject.title ?? null,
                    sourceMessageHref: buildMessageSourceHref(messageRow.conversationId, messageRow.id),
                    sourcePreview,
                },
            });

            return {
                task: taskRow,
                link: linkRow,
                project: {
                    id: params.projectId,
                    slug: targetProject.slug ?? null,
                    title: targetProject.title ?? null,
                    key: targetProject.key ?? null,
                },
            };
        });

        await queueCounterRefreshBestEffort([taskAssigneeId]);
        revalidatePath(`/projects/${params.projectId}`);

        if (taskAssigneeId && taskAssigneeId !== user.id) {
            try {
                const actor = await readActorNotificationSnapshot(user);
                await enqueueProjectNotificationEvent({
                    projectId: params.projectId,
                    actorUserId: user.id,
                    ...actor,
                    eventKey: "tasks.created_assigned",
                    assigneeId: taskAssigneeId,
                    title: `${actor.actorName || "Someone"} assigned you a task`,
                    body: taskResult.task.title,
                    href: projectTaskHref(taskResult.project.slug || params.projectId, taskResult.task.id),
                    entityRefs: {
                        projectId: params.projectId,
                        projectSlug: taskResult.project.slug,
                        taskId: taskResult.task.id,
                        sourceMessageId: messageRow.id,
                        conversationId: messageRow.conversationId,
                    },
                    preview: {
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        contextLabel: taskResult.project.key && taskResult.task.taskNumber ? `${taskResult.project.key}-${taskResult.task.taskNumber}` : "Task",
                        contextKind: "task",
                        secondaryText: taskResult.task.title,
                    },
                    sourceEventId: `${taskResult.task.id}:created-assigned`,
                });
            } catch (notificationError) {
                logger.warn('messages.collaboration.task_assignment_notification_failed', {
                    module: 'messaging',
                    conversationId: messageRow.conversationId,
                    messageId: messageRow.id,
                    projectId: params.projectId,
                    taskId: taskResult.task.id,
                    actorUserId: user.id,
                    targetUserId: taskAssigneeId,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }

        const [conversationProject] = await db
            .select({ id: projects.id, title: projects.title })
            .from(projects)
            .where(eq(projects.conversationId, messageRow.conversationId))
            .limit(1);

        const bridgeMessage = conversationProject?.id === params.projectId
            ? await emitActivityBridgeMessage({
                conversationId: messageRow.conversationId,
                senderId: user.id,
                title: 'Task created from message',
                summary: `Created task #${taskResult.task.taskNumber} ${taskResult.task.title}`,
                contextChips: [{
                    kind: 'task',
                    id: taskResult.task.id,
                    label: `#${taskResult.task.taskNumber} ${taskResult.task.title}`,
                    subtitle: conversationProject.title,
                }],
                entityRefs: {
                    projectId: params.projectId,
                    taskId: taskResult.task.id,
                    messageId: messageRow.id,
                },
            })
            : null;

        return {
            success: true,
            conversationId: messageRow.conversationId,
            taskId: taskResult.task.id,
            link: mapMessageWorkLinkToSummary(taskResult.link),
            bridgeMessage,
        };
    } catch (error) {
        logger.error('messages.collaboration.convert_message_to_task_failed', {
            module: 'messaging',
            messageId: params.messageId,
            projectId: params.projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create task' };
    }
}

export async function convertMessageToFollowUpActionV2(params: {
    messageId: string;
    note?: string | null;
    dueAt?: string | null;
}): Promise<{ success: boolean; error?: string; conversationId?: string; workflowItemId?: string; link?: MessageLinkedWorkSummary }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        if (!isMessagingPrivateFollowUpsEnabled(user.id)) {
            return { success: false, error: 'Private follow-ups are unavailable' };
        }

        const [messageRow] = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                content: messages.content,
                metadata: messages.metadata,
            })
            .from(messages)
            .where(eq(messages.id, params.messageId))
            .limit(1);

        if (!messageRow) return { success: false, error: 'Message not found' };
        await requireConversationAccess(messageRow.conversationId, user.id);
        const dueAt = parseValidDate(params.dueAt);
        if (params.dueAt && !dueAt) {
            return { success: false, error: 'Invalid due date' };
        }

        const structured = getStructuredMessageFromMetadata(
            messageRow.metadata as Record<string, unknown> | null,
        );
        const preview = getMessagePreviewText({
            content: messageRow.content,
            type: structured?.kind || null,
            metadata: messageRow.metadata as Record<string, unknown> | null,
        });
        const result = await db.transaction(async (tx) => {
            const [workflowRow] = await tx
                .insert(messageWorkflowItems)
                .values({
                    messageId: messageRow.id,
                    conversationId: messageRow.conversationId,
                    kind: 'follow_up',
                    scope: 'private',
                    creatorId: user.id,
                    assigneeUserId: user.id,
                    status: 'pending',
                    payload: {
                        note: params.note?.trim() || null,
                        dueAt: params.dueAt || null,
                        preview,
                    },
                    dueAt,
                })
                .returning({ id: messageWorkflowItems.id });

            if (!workflowRow?.id) throw new Error('Failed to create follow-up');
            const link = await upsertMessageWorkLink(tx, {
                sourceMessageId: messageRow.id,
                sourceConversationId: messageRow.conversationId,
                targetType: 'follow_up',
                targetId: workflowRow.id,
                targetProjectId: null,
                visibility: 'private',
                status: 'pending',
                ownerUserId: user.id,
                assigneeUserId: user.id,
                createdBy: user.id,
                href: buildMessageSourceHref(messageRow.conversationId, messageRow.id),
                metadata: {
                    label: 'Follow-up',
                    subtitle: params.note?.trim() || preview,
                    note: params.note?.trim() || null,
                    preview,
                    dueAt: dueAt?.toISOString() ?? null,
                    dueDate: dueAt ? formatDueDateKey(dueAt) : null,
                },
            });

            return { workflowItemId: workflowRow.id, link };
        });

        return {
            success: true,
            conversationId: messageRow.conversationId,
            workflowItemId: result.workflowItemId,
            link: mapMessageWorkLinkToSummary(result.link),
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create follow-up' };
    }
}
