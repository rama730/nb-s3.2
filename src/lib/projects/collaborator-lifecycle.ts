import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
    conversationParticipants,
    conversations,
    profiles,
    projectMembers,
    projectNodeEvents,
    projectOpenRoles,
    projects,
    roleApplications,
    taskNodeLinks,
    tasks,
    projectNodes,
    messageWorkflowItems,
} from "@/lib/db/schema";
import {
    isEligibleProjectMember,
    normalizeProjectMemberRole,
    projectMemberCan,
    type ProjectMemberCapability,
    type ProjectMemberEligibility,
    type ProjectMemberRole,
} from "@/lib/projects/settings-policies";
import {
    endProfileProjectContributionMembership,
    markProfileCollaborationSummaryStale,
    upsertProfileProjectContributionFromMembership,
} from "@/lib/profile/collaboration";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ProjectCollaboratorExecutor = typeof db | DbTransaction;

export type ProjectCollaboratorSnapshot = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
};

export type ProjectCollaboratorLifecycleResult = {
    eventId: string | null;
    changed: boolean;
    project: {
        id: string;
        ownerId: string;
        title: string | null;
        slug: string | null;
        conversationId: string | null;
    };
    target: ProjectCollaboratorSnapshot | null;
    previousRole: ProjectMemberRole | null;
    nextRole: ProjectMemberRole | null;
};

function displayNameForSnapshot(snapshot: ProjectCollaboratorSnapshot | null) {
    return snapshot?.fullName || snapshot?.username || "Project member";
}

function roleRank(role: ProjectMemberRole | null) {
    switch (role) {
        case "owner":
            return 4;
        case "admin":
            return 3;
        case "member":
            return 2;
        case "viewer":
            return 1;
        default:
            return 0;
    }
}

async function readProjectForUpdate(executor: ProjectCollaboratorExecutor, projectId: string) {
    const rows = await executor.execute<{
        id: string;
        owner_id: string;
        title: string | null;
        slug: string | null;
        conversation_id: string | null;
    }>(sql`
        SELECT id, owner_id, title, slug, conversation_id
        FROM ${projects}
        WHERE id = ${projectId} AND deleted_at IS NULL
        FOR UPDATE
    `);
    const row = Array.from(rows)[0];
    if (!row) return null;
    return {
        id: row.id,
        ownerId: row.owner_id,
        title: row.title,
        slug: row.slug,
        conversationId: row.conversation_id,
    };
}

async function readProfileSnapshot(executor: ProjectCollaboratorExecutor, userId: string): Promise<ProjectCollaboratorSnapshot | null> {
    const [profile] = await executor
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
    return profile ?? null;
}

async function readMembershipRole(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    userId: string,
    ownerId: string,
    lock = false,
) {
    if (userId === ownerId) return "owner" as ProjectMemberRole;
    if (lock) {
        const rows = await executor.execute<{ role: ProjectMemberRole }>(sql`
            SELECT role
            FROM ${projectMembers}
            WHERE project_id = ${projectId} AND user_id = ${userId}
            FOR UPDATE
        `);
        const row = Array.from(rows)[0];
        return row ? normalizeProjectMemberRole(row.role) : null;
    }
    const [member] = await executor
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .limit(1);
    return member ? normalizeProjectMemberRole(member.role) : null;
}

export function canProjectRoleManageTarget(params: {
    actorRole: ProjectMemberRole | null;
    targetRole: ProjectMemberRole | null;
    nextRole?: ProjectMemberRole | null;
}) {
    const { actorRole, targetRole, nextRole = null } = params;
    if (!actorRole || !targetRole || targetRole === "owner") return false;
    if (actorRole === "owner") return true;
    if (actorRole !== "admin") return false;
    return (
        (targetRole === "member" || targetRole === "viewer") &&
        (!nextRole || nextRole === "member" || nextRole === "viewer")
    );
}

export function isProjectMemberEligibleFor(role: unknown, eligibility: ProjectMemberEligibility) {
    return isEligibleProjectMember(role, eligibility);
}

export async function requireProjectCapability(
    projectId: string,
    userId: string,
    capability: ProjectMemberCapability,
    executor: ProjectCollaboratorExecutor = db,
) {
    const [project] = await executor
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);
    if (!project) throw new Error("Project not found");
    const role = await readMembershipRole(executor, projectId, userId, project.ownerId, false);
    if (!role || !projectMemberCan(role, capability)) {
        throw new Error("You do not have permission to perform this project action");
    }
    return { project, role };
}

async function ensureProjectGroupConversationIdInternal(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    ownerId: string,
) {
    const project = await readProjectForUpdate(executor, projectId);
    if (!project) throw new Error("Project not found");
    if (project.conversationId) return project.conversationId;

    const [conversation] = await executor
        .insert(conversations)
        .values({ type: "project_group" })
        .returning({ id: conversations.id });
    if (!conversation) throw new Error("Failed to create project conversation");

    await executor
        .update(projects)
        .set({ conversationId: conversation.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

    const memberRows = await executor
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId));
    const participantIds = Array.from(new Set([ownerId, ...memberRows.map((member) => member.userId)]));
    if (participantIds.length > 0) {
        await executor
            .insert(conversationParticipants)
            .values(participantIds.map((userId) => ({ conversationId: conversation.id, userId })))
            .onConflictDoNothing({
                target: [conversationParticipants.conversationId, conversationParticipants.userId],
            });
    }
    return conversation.id;
}

export async function syncProjectGroupParticipantInternal(
    executor: ProjectCollaboratorExecutor,
    params: { projectId: string; userId: string; ownerId: string; mode: "add" | "remove" },
) {
    if (params.mode === "add") {
        const conversationId = await ensureProjectGroupConversationIdInternal(executor, params.projectId, params.ownerId);
        await executor
            .insert(conversationParticipants)
            .values({ conversationId, userId: params.userId })
            .onConflictDoNothing({
                target: [conversationParticipants.conversationId, conversationParticipants.userId],
            });
        return conversationId;
    }

    const [project] = await executor
        .select({ conversationId: projects.conversationId })
        .from(projects)
        .where(eq(projects.id, params.projectId))
        .limit(1);
    if (!project?.conversationId) return null;
    await executor
        .delete(conversationParticipants)
        .where(and(
            eq(conversationParticipants.conversationId, project.conversationId),
            eq(conversationParticipants.userId, params.userId),
        ));
    return project.conversationId;
}

export async function addProjectMemberInternal(
    executor: ProjectCollaboratorExecutor,
    params: {
        projectId: string;
        userId: string;
        role?: Exclude<ProjectMemberRole, "owner">;
        actorId: string;
        source: "application_accept" | "project_invite" | "manual" | "ownership_transfer";
        applicationId?: string | null;
        roleId?: string | null;
        incrementRoleCapacity?: boolean;
        syncGroupConversation?: boolean;
    },
): Promise<ProjectCollaboratorLifecycleResult & { conversationId: string | null }> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new Error("Project not found");
    const target = await readProfileSnapshot(executor, params.userId);
    const previousRole = await readMembershipRole(executor, params.projectId, params.userId, project.ownerId, true);
    const nextRole = params.userId === project.ownerId ? "owner" : normalizeProjectMemberRole(params.role ?? "member", "member");
    let changed = false;

    if (!previousRole) {
        await executor.insert(projectMembers).values({
            projectId: params.projectId,
            userId: params.userId,
            role: nextRole === "owner" ? "member" : nextRole,
        });
        changed = true;
    } else if (
        previousRole !== "owner" &&
        nextRole !== "owner" &&
        roleRank(nextRole) > roleRank(previousRole)
    ) {
        await executor
            .update(projectMembers)
            .set({ role: nextRole })
            .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.userId)));
        changed = true;
    }

    if (params.incrementRoleCapacity && params.roleId) {
        const roleRows = await executor
            .select({ id: projectOpenRoles.id, filled: projectOpenRoles.filled, count: projectOpenRoles.count })
            .from(projectOpenRoles)
            .where(eq(projectOpenRoles.id, params.roleId))
            .for("update")
            .limit(1);
        const role = roleRows[0];
        if (!role || role.filled >= role.count) throw new Error("Role is full");
        await executor
            .update(projectOpenRoles)
            .set({ filled: sql`${projectOpenRoles.filled} + 1`, updatedAt: new Date() })
            .where(eq(projectOpenRoles.id, params.roleId));

        if (role.filled + 1 >= role.count) {
            // Find user IDs to invalidate
            const [otherApps, otherInvites] = await Promise.all([
                executor
                    .select({ applicantId: roleApplications.applicantId })
                    .from(roleApplications)
                    .where(and(
                        eq(roleApplications.projectId, params.projectId),
                        eq(roleApplications.roleId, params.roleId),
                        eq(roleApplications.status, 'pending')
                    )),
                executor
                    .select({ assigneeUserId: messageWorkflowItems.assigneeUserId })
                    .from(messageWorkflowItems)
                    .where(and(
                        eq(messageWorkflowItems.projectId, params.projectId),
                        eq(messageWorkflowItems.kind, 'project_invite'),
                        eq(messageWorkflowItems.status, 'pending'),
                        sql`${messageWorkflowItems.payload}->>'roleId' = ${params.roleId}`
                    ))
            ]);

            const userIdsToInvalidate = new Set<string>();
            otherApps.forEach(a => userIdsToInvalidate.add(a.applicantId));
            otherInvites.forEach(i => {
                if (i.assigneeUserId) userIdsToInvalidate.add(i.assigneeUserId);
            });

            // Sweep database records
            await executor
                .update(roleApplications)
                .set({ status: 'rejected', decisionAt: new Date(), updatedAt: new Date() })
                .where(and(
                    eq(roleApplications.projectId, params.projectId),
                    eq(roleApplications.roleId, params.roleId),
                    eq(roleApplications.status, 'pending')
                ));

            await executor
                .update(messageWorkflowItems)
                .set({ status: 'expired', resolvedAt: new Date(), updatedAt: new Date() })
                .where(and(
                    eq(messageWorkflowItems.projectId, params.projectId),
                    eq(messageWorkflowItems.kind, 'project_invite'),
                    eq(messageWorkflowItems.status, 'pending'),
                    sql`${messageWorkflowItems.payload}->>'roleId' = ${params.roleId}`
                ));

            if (userIdsToInvalidate.size > 0) {
                // Invalidate caches (non-blocking)
                const { invalidateDiscoverCacheForUsers } = await import('@/lib/connections/internal-helpers');
                invalidateDiscoverCacheForUsers(userIdsToInvalidate).catch(console.error);
            }
        }
    }

    const conversationId = params.syncGroupConversation !== false
        ? await syncProjectGroupParticipantInternal(executor, {
            projectId: params.projectId,
            userId: params.userId,
            ownerId: project.ownerId,
            mode: "add",
        })
        : project.conversationId;

    const [event] = await executor.insert(projectNodeEvents).values({
        projectId: params.projectId,
        actorId: params.actorId,
        nodeId: null,
        type: "project_member.added",
        metadata: {
            targetUserId: params.userId,
            targetSnapshot: target,
            previousRole,
            nextRole,
            source: params.source,
            applicationId: params.applicationId ?? null,
            roleId: params.roleId ?? null,
            targetDisplayName: displayNameForSnapshot(target),
        },
        createdAt: new Date(),
    }).returning({ id: projectNodeEvents.id });

    if (changed) {
        await upsertProfileProjectContributionFromMembership(executor, {
            profileId: params.userId,
            projectId: params.projectId,
            verifiedBy: params.actorId,
            previousRole,
            nextRole,
            eventId: event?.id ?? null,
            source: params.source === "project_invite"
                ? "project_invite"
                : params.source === "application_accept"
                    ? "application"
                    : params.source === "ownership_transfer"
                        ? "ownership_transfer"
                        : "membership",
        });
        await markProfileCollaborationSummaryStale(project.ownerId, executor);
    }

    return { eventId: event?.id ?? null, changed, project: { ...project, conversationId }, target, previousRole, nextRole, conversationId };
}

export async function changeProjectMemberRoleInternal(
    executor: ProjectCollaboratorExecutor,
    params: {
        projectId: string;
        actorId: string;
        targetUserId: string;
        nextRole: Exclude<ProjectMemberRole, "owner">;
    },
): Promise<ProjectCollaboratorLifecycleResult> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new Error("Project not found");
    const actorRole = await readMembershipRole(executor, params.projectId, params.actorId, project.ownerId, true);
    const previousRole = await readMembershipRole(executor, params.projectId, params.targetUserId, project.ownerId, true);
    if (!canProjectRoleManageTarget({ actorRole, targetRole: previousRole, nextRole: params.nextRole })) {
        throw new Error("You do not have permission to manage this collaborator");
    }
    if (previousRole === params.nextRole) {
        return { eventId: null, changed: false, project, target: await readProfileSnapshot(executor, params.targetUserId), previousRole, nextRole: params.nextRole };
    }

    const target = await readProfileSnapshot(executor, params.targetUserId);
    await executor
        .update(projectMembers)
        .set({ role: params.nextRole })
        .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.targetUserId)));
    const [event] = await executor.insert(projectNodeEvents).values({
        projectId: params.projectId,
        actorId: params.actorId,
        nodeId: null,
        type: "project_member.role_changed",
        metadata: {
            targetUserId: params.targetUserId,
            targetSnapshot: target,
            previousRole,
            nextRole: params.nextRole,
            targetDisplayName: displayNameForSnapshot(target),
        },
        createdAt: new Date(),
    }).returning({ id: projectNodeEvents.id });

    await upsertProfileProjectContributionFromMembership(executor, {
        profileId: params.targetUserId,
        projectId: params.projectId,
        verifiedBy: params.actorId,
        previousRole,
        nextRole: params.nextRole,
        eventId: event?.id ?? null,
        source: "role_change",
    });

    return { eventId: event?.id ?? null, changed: true, project, target, previousRole, nextRole: params.nextRole };
}

export async function readProjectMemberRemovalImpact(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    memberUserId: string,
) {
    const [assignedTasks, createdTasks, fileReviews, acceptedApplications, candidates, projectRow] = await Promise.all([
        executor
            .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, memberUserId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
            .orderBy(sql`${tasks.updatedAt} DESC`)
            .limit(8),
        executor
            .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.creatorId, memberUserId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
            .orderBy(sql`${tasks.updatedAt} DESC`)
            .limit(8),
        executor
            .select({
                id: taskNodeLinks.id,
                taskId: taskNodeLinks.taskId,
                taskTitle: tasks.title,
                nodeName: projectNodes.name,
                annotation: taskNodeLinks.annotation,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
            .where(and(
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
                isNull(projectNodes.deletedAt),
                eq(taskNodeLinks.createdBy, memberUserId),
                sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
            ))
            .limit(8),
        executor
            .select({
                id: roleApplications.id,
                roleId: roleApplications.roleId,
                roleTitle: projectOpenRoles.title,
                roleName: projectOpenRoles.role,
            })
            .from(roleApplications)
            .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.applicantId, memberUserId), eq(roleApplications.status, "accepted")))
            .limit(8),
        executor
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                role: projectMembers.role,
            })
            .from(projectMembers)
            .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(
                eq(projectMembers.projectId, projectId),
                inArray(projectMembers.role, ["owner", "admin", "member"]),
                sql`${projectMembers.userId} <> ${memberUserId}`,
            ))
            .orderBy(sql`CASE WHEN ${projectMembers.role} = 'owner' THEN 0 WHEN ${projectMembers.role} = 'admin' THEN 1 ELSE 2 END`, sql`${profiles.fullName} ASC NULLS LAST`)
            .limit(20),
        executor
            .select({ conversationId: projects.conversationId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1),
    ]);

    const participantRows = projectRow[0]?.conversationId
        ? await executor
            .select({ userId: conversationParticipants.userId })
            .from(conversationParticipants)
            .where(and(
                eq(conversationParticipants.conversationId, projectRow[0].conversationId),
                eq(conversationParticipants.userId, memberUserId),
            ))
            .limit(1)
        : [];

    return {
        assignedTasks,
        createdTasks,
        fileReviews,
        acceptedApplications,
        projectGroupParticipant: participantRows.length > 0,
        reassignmentCandidates: candidates.filter((candidate) => isEligibleProjectMember(candidate.role, "assign")),
    };
}

async function readProjectMemberRemovalImpactCounts(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    memberUserId: string,
) {
    const [assignedTasks, createdTasks, fileReviews, acceptedApplications, projectRow] = await Promise.all([
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, memberUserId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
            .limit(1),
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.creatorId, memberUserId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
            .limit(1),
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
            .where(and(
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
                isNull(projectNodes.deletedAt),
                eq(taskNodeLinks.createdBy, memberUserId),
                sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
            ))
            .limit(1),
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(roleApplications)
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.applicantId, memberUserId), eq(roleApplications.status, "accepted")))
            .limit(1),
        executor
            .select({ conversationId: projects.conversationId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1),
    ]);

    const participantRows = projectRow[0]?.conversationId
        ? await executor
            .select({ userId: conversationParticipants.userId })
            .from(conversationParticipants)
            .where(and(
                eq(conversationParticipants.conversationId, projectRow[0].conversationId),
                eq(conversationParticipants.userId, memberUserId),
            ))
            .limit(1)
        : [];

    return {
        activeAssignedTasks: Number(assignedTasks[0]?.count ?? 0),
        activeCreatedTasks: Number(createdTasks[0]?.count ?? 0),
        fileReviews: Number(fileReviews[0]?.count ?? 0),
        acceptedApplications: Number(acceptedApplications[0]?.count ?? 0),
        projectGroupParticipant: participantRows.length > 0,
    };
}

export async function removeProjectMemberInternal(
    executor: ProjectCollaboratorExecutor,
    params: {
        projectId: string;
        actorId: string;
        targetUserId: string;
        mode: "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
        reassignToUserId?: string | null;
    },
): Promise<ProjectCollaboratorLifecycleResult> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new Error("Project not found");
    const actorRole = await readMembershipRole(executor, params.projectId, params.actorId, project.ownerId, true);
    const previousRole = await readMembershipRole(executor, params.projectId, params.targetUserId, project.ownerId, true);
    if (!canProjectRoleManageTarget({ actorRole, targetRole: previousRole })) {
        throw new Error("You do not have permission to remove this collaborator");
    }
    const target = await readProfileSnapshot(executor, params.targetUserId);
    const impact = await readProjectMemberRemovalImpact(executor, params.projectId, params.targetUserId);
    const impactCounts = await readProjectMemberRemovalImpactCounts(executor, params.projectId, params.targetUserId);

    if (params.mode === "unassign_active_tasks") {
        await executor
            .update(tasks)
            .set({ assigneeId: null, updatedAt: new Date() })
            .where(and(eq(tasks.projectId, params.projectId), eq(tasks.assigneeId, params.targetUserId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`));
    } else if (params.mode === "reassign_active_tasks") {
        const replacementId = params.reassignToUserId;
        if (!replacementId || replacementId === params.targetUserId) throw new Error("Choose a valid replacement assignee");
        const replacementRole = await readMembershipRole(executor, params.projectId, replacementId, project.ownerId, true);
        if (!replacementRole || !isEligibleProjectMember(replacementRole, "assign")) {
            throw new Error("Replacement assignee must be an assignable project member");
        }
        await executor
            .update(tasks)
            .set({ assigneeId: replacementId, updatedAt: new Date() })
            .where(and(eq(tasks.projectId, params.projectId), eq(tasks.assigneeId, params.targetUserId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`));
    }

    await syncProjectGroupParticipantInternal(executor, {
        projectId: params.projectId,
        userId: params.targetUserId,
        ownerId: project.ownerId,
        mode: "remove",
    });
    await executor
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.targetUserId)));

    const [capacityApplication] = await executor
        .select({ roleId: roleApplications.roleId })
        .from(roleApplications)
        .where(and(eq(roleApplications.projectId, params.projectId), eq(roleApplications.applicantId, params.targetUserId), eq(roleApplications.status, "accepted")))
        .orderBy(desc(roleApplications.updatedAt))
        .limit(1);
    if (capacityApplication?.roleId) {
        await executor
            .update(projectOpenRoles)
            .set({ filled: sql`greatest(${projectOpenRoles.filled} - 1, 0)`, updatedAt: new Date() })
            .where(eq(projectOpenRoles.id, capacityApplication.roleId));
    }

    const [event] = await executor.insert(projectNodeEvents).values({
        projectId: params.projectId,
        actorId: params.actorId,
        nodeId: null,
        type: "project_member.removed",
        metadata: {
            targetUserId: params.targetUserId,
            targetSnapshot: target,
            previousRole,
            removalMode: params.mode,
            reassignToUserId: params.reassignToUserId ?? null,
            targetDisplayName: displayNameForSnapshot(target),
            affectedCounts: {
                activeAssignedTasks: impactCounts.activeAssignedTasks,
                activeCreatedTasks: impactCounts.activeCreatedTasks,
                fileReviews: impactCounts.fileReviews,
                acceptedApplications: impactCounts.acceptedApplications,
                projectGroupParticipant: impactCounts.projectGroupParticipant,
            },
        },
        createdAt: new Date(),
    }).returning({ id: projectNodeEvents.id });

    await endProfileProjectContributionMembership(executor, {
        profileId: params.targetUserId,
        projectId: params.projectId,
        verifiedBy: params.actorId,
        eventId: event?.id ?? null,
    });
    await markProfileCollaborationSummaryStale(project.ownerId, executor);

    return { eventId: event?.id ?? null, changed: true, project, target, previousRole, nextRole: null };
}
