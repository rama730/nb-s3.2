import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
    profiles,
    projectGuidanceAppointments,
    projectInvitations,
    projectMembers,
    projectNodeEvents,
    projectOpenRoles,
    projects,
    roleApplications,
} from "@/lib/db/schema";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getGuidanceCapacityState } from "@/lib/projects/guidance-capacity";
import {
    addProjectMemberInternal,
    changeProjectMemberRoleInternal,
    removeProjectMemberInternal,
    type ProjectCollaboratorExecutor,
} from "@/lib/projects/collaborator-lifecycle";

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type ProjectInvitationKind = "ordinary_role" | "guidance_appointment";
export type ProjectInvitationStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export type CreateProjectInvitationInput = {
    actorId: string;
    candidateId: string;
    projectId: string;
    kind: ProjectInvitationKind;
    roleId?: string | null;
    note?: string | null;
    guidanceLabel?: string | null;
    reviewAt?: Date | null;
    idempotencyKey?: string | null;
};

type InvitationExecutor = ProjectCollaboratorExecutor;

function cleanOptionalText(value: string | null | undefined, limit: number) {
    const cleaned = value?.trim().replace(/\s+/g, " ") ?? "";
    return cleaned ? cleaned.slice(0, limit) : null;
}

function cleanGuidanceLabel(value: string | null | undefined) {
    return cleanOptionalText(value, 60);
}

async function lockProject(executor: InvitationExecutor, projectId: string) {
    const rows = await executor.execute<{
        id: string;
        owner_id: string;
        title: string | null;
        slug: string | null;
        status: string | null;
    }>(sql`
        SELECT id, owner_id, title, slug, status
        FROM ${projects}
        WHERE id = ${projectId} AND deleted_at IS NULL
        FOR UPDATE
    `);
    return Array.from(rows)[0] ?? null;
}

async function readManagerRole(executor: InvitationExecutor, projectId: string, actorId: string, ownerId: string) {
    if (actorId === ownerId) return "owner" as const;
    const [membership] = await executor
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
        .limit(1);
    return membership?.role === "admin" ? "admin" as const : null;
}

async function activeGuidanceCount(executor: InvitationExecutor, guideUserId: string) {
    const [row] = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(projectGuidanceAppointments)
        .where(and(
            eq(projectGuidanceAppointments.guideUserId, guideUserId),
            eq(projectGuidanceAppointments.status, "active"),
        ));
    return row?.count ?? 0;
}

export async function createProjectInvitation(input: CreateProjectInvitationInput) {
    const now = new Date();
    const idempotencyKey = cleanOptionalText(input.idempotencyKey, 160);
    const privacy = await resolvePrivacyRelationship(input.actorId, input.candidateId);
    if (!privacy?.canViewProfile || privacy.blockedByViewer || privacy.blockedByTarget) {
        throw new Error("This person is not eligible for an invitation");
    }

    return db.transaction(async (tx) => {
        if (input.actorId === input.candidateId) throw new Error("Choose another collaborator to invite");

        if (idempotencyKey) {
            const [existing] = await tx
                .select()
                .from(projectInvitations)
                .where(and(
                    eq(projectInvitations.inviterId, input.actorId),
                    eq(projectInvitations.idempotencyKey, idempotencyKey),
                ))
                .limit(1);
            if (existing) return { invitation: existing, created: false, projectSlug: null };
        }

        const project = await lockProject(tx, input.projectId);
        if (!project || project.status === "archived") throw new Error("Project is unavailable");

        await tx.update(projectInvitations)
            .set({ status: "expired", resolvedAt: now, updatedAt: now })
            .where(and(
                eq(projectInvitations.projectId, input.projectId),
                eq(projectInvitations.status, "pending"),
                // Keep this comparison in PostgreSQL. Raw SQL interpolation does not
                // encode JavaScript Date values for the postgres driver, which would
                // otherwise prevent every new invitation from being created.
                sql`${projectInvitations.expiresAt} <= now()`,
            ));

        const managerRole = await readManagerRole(tx, input.projectId, input.actorId, project.owner_id);
        if (!managerRole) throw new Error("You can only invite to projects you manage");
        if (input.kind === "guidance_appointment" && managerRole !== "owner") {
            throw new Error("Only the project Lead can appoint a guidance co-leader");
        }

        const [candidate] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, input.candidateId))
            .limit(1);
        if (!candidate) throw new Error("Candidate not found");
        if (input.candidateId === project.owner_id) throw new Error("The current project Owner cannot hold this appointment");

        const [existingMember] = await tx
            .select({ id: projectMembers.id })
            .from(projectMembers)
            .where(and(
                eq(projectMembers.projectId, input.projectId),
                eq(projectMembers.userId, input.candidateId),
            ))
            .limit(1);
        if (existingMember) throw new Error("User is already a member of this project");

        const [pendingApplication] = await tx
            .select({ id: roleApplications.id })
            .from(roleApplications)
            .where(and(
                eq(roleApplications.projectId, input.projectId),
                eq(roleApplications.applicantId, input.candidateId),
                eq(roleApplications.status, "pending"),
            ))
            .limit(1);
        if (pendingApplication) throw new Error("Review the existing application before sending an invitation");

        let roleId: string | null = null;
        let roleTitle: string | null = null;
        let guidanceLabel: string | null = null;

        if (input.kind === "ordinary_role") {
            if (!input.roleId) throw new Error("Select an available role");
            const [role] = await tx
                .select({ id: projectOpenRoles.id, title: projectOpenRoles.title, role: projectOpenRoles.role, filled: projectOpenRoles.filled, count: projectOpenRoles.count })
                .from(projectOpenRoles)
                .where(and(eq(projectOpenRoles.id, input.roleId), eq(projectOpenRoles.projectId, input.projectId)))
                .limit(1);
            if (!role || (role.filled ?? 0) >= (role.count ?? 0)) throw new Error("This project role is no longer available");
            roleId = role.id;
            roleTitle = cleanOptionalText(role.title || role.role || "Collaborator", 160) || "Collaborator";

            const [pending] = await tx
                .select({ id: projectInvitations.id })
                .from(projectInvitations)
                .where(and(
                    eq(projectInvitations.projectId, input.projectId),
                    eq(projectInvitations.candidateId, input.candidateId),
                    eq(projectInvitations.kind, "ordinary_role"),
                    eq(projectInvitations.status, "pending"),
                ))
                .limit(1);
            if (pending) throw new Error("An invitation for this project is already pending");
        } else {
            guidanceLabel = cleanGuidanceLabel(input.guidanceLabel);
            if (!guidanceLabel) throw new Error("Enter a guidance label");

            const [pending] = await tx
                .select({ id: projectInvitations.id })
                .from(projectInvitations)
                .where(and(
                    eq(projectInvitations.projectId, input.projectId),
                    eq(projectInvitations.kind, "guidance_appointment"),
                    eq(projectInvitations.status, "pending"),
                ))
                .limit(1);
            const [active] = await tx
                .select({ id: projectGuidanceAppointments.id })
                .from(projectGuidanceAppointments)
                .where(and(
                    eq(projectGuidanceAppointments.projectId, input.projectId),
                    eq(projectGuidanceAppointments.status, "active"),
                ))
                .limit(1);
            if (pending || active) throw new Error("This project already has a pending or active guidance appointment");

            const count = await activeGuidanceCount(tx, input.candidateId);
            if (getGuidanceCapacityState(count) === "blocked") throw new Error("This person has reached the active guidance appointment limit");
        }

        const [invitation] = await tx
            .insert(projectInvitations)
            .values({
                projectId: input.projectId,
                inviterId: input.actorId,
                candidateId: input.candidateId,
                kind: input.kind,
                roleId,
                roleTitle,
                guidanceLabel,
                note: cleanOptionalText(input.note, 500),
                projectTitle: cleanOptionalText(project.title, 200) || "Project",
                status: "pending",
                expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
                reviewAt: input.reviewAt ?? null,
                idempotencyKey,
                createdAt: now,
                updatedAt: now,
            })
            .returning();

        if (!invitation) throw new Error("Failed to create invitation");
        return {
            invitation,
            created: true,
            projectSlug: project.slug,
            capacityWarning: input.kind === "guidance_appointment" && getGuidanceCapacityState(await activeGuidanceCount(tx, input.candidateId)) === "warning",
        };
    });
}

export async function resolveProjectInvitationInternal(
    executor: InvitationExecutor,
    input: { invitationId: string; actorId: string; action: "accept" | "decline" | "cancel" },
) {
    const [invitation] = await executor
        .select()
        .from(projectInvitations)
        .where(eq(projectInvitations.id, input.invitationId))
        .for("update")
        .limit(1);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending") throw new Error("This invitation has already been resolved");

    const now = new Date();
    if (invitation.expiresAt <= now) {
        await executor.update(projectInvitations)
            .set({ status: "expired", resolvedAt: now, updatedAt: now })
            .where(eq(projectInvitations.id, invitation.id));
        throw new Error("This invitation has expired");
    }

    const project = await lockProject(executor, invitation.projectId);
    if (!project || project.status === "archived") throw new Error("Project is unavailable");

    const isCandidate = invitation.candidateId === input.actorId;
    const isLead = project.owner_id === input.actorId;
    if (input.action === "cancel") {
        if (!isLead && invitation.inviterId !== input.actorId) throw new Error("Only the inviter or project Lead can cancel this invitation");
        await executor.update(projectInvitations)
            .set({ status: "cancelled", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
            .where(eq(projectInvitations.id, invitation.id));
        return { invitation, lifecycle: null, appointment: null };
    }
    if (!isCandidate) throw new Error("Only the invited person can resolve this invitation");
    if (input.action === "decline") {
        await executor.update(projectInvitations)
            .set({ status: "declined", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
            .where(eq(projectInvitations.id, invitation.id));
        return { invitation, lifecycle: null, appointment: null };
    }

    if (invitation.candidateId === project.owner_id) throw new Error("The current project Owner cannot hold this appointment");

    let appointment: typeof projectGuidanceAppointments.$inferSelect | null = null;
    if (invitation.kind === "guidance_appointment") {
        const [active] = await executor
            .select({ id: projectGuidanceAppointments.id })
            .from(projectGuidanceAppointments)
            .where(and(
                eq(projectGuidanceAppointments.projectId, invitation.projectId),
                eq(projectGuidanceAppointments.status, "active"),
            ))
            .limit(1);
        if (active) throw new Error("This project already has an active guidance appointment");
        const count = await activeGuidanceCount(executor, invitation.candidateId);
        if (getGuidanceCapacityState(count) === "blocked") throw new Error("This person has reached the active guidance appointment limit");
    }

    const lifecycle = await addProjectMemberInternal(executor, {
        projectId: invitation.projectId,
        userId: invitation.candidateId,
        role: invitation.kind === "guidance_appointment" ? "admin" : "member",
        actorId: input.actorId,
        source: "project_invite",
        roleId: invitation.kind === "ordinary_role" ? invitation.roleId : null,
        incrementRoleCapacity: invitation.kind === "ordinary_role" && Boolean(invitation.roleId),
        syncGroupConversation: true,
    });

    if (invitation.kind === "guidance_appointment") {
        const [createdAppointment] = await executor
            .insert(projectGuidanceAppointments)
            .values({
                projectId: invitation.projectId,
                guideUserId: invitation.candidateId,
                invitationId: invitation.id,
                label: invitation.guidanceLabel || "Guide",
                status: "active",
                reviewAt: invitation.reviewAt,
                previousMembershipRole: lifecycle.previousRole,
                acceptedAt: now,
                createdAt: now,
                updatedAt: now,
            })
            .returning();
        appointment = createdAppointment ?? null;
        await executor.insert(projectNodeEvents).values({
            projectId: invitation.projectId,
            actorId: input.actorId,
            nodeId: null,
            type: "project_guidance.activated",
            metadata: {
                invitationId: invitation.id,
                guideUserId: invitation.candidateId,
                label: invitation.guidanceLabel,
                previousMembershipRole: lifecycle.previousRole,
            },
            createdAt: now,
        });
    }

    await executor.update(projectInvitations)
        .set({ status: "accepted", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
        .where(eq(projectInvitations.id, invitation.id));

    return { invitation, lifecycle, appointment };
}

export function projectInvitationDisplayRole(invitation: typeof projectInvitations.$inferSelect) {
    return invitation.kind === "guidance_appointment"
        ? invitation.guidanceLabel || "Guide"
        : invitation.roleTitle || "Collaborator";
}

export async function endProjectGuidanceAppointmentInternal(
    executor: InvitationExecutor,
    input: {
        projectId: string;
        actorId: string;
        outcome: "restore_previous_role" | "keep_admin" | "keep_member" | "remove";
        removalMode?: "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
        reassignToUserId?: string | null;
        reason?: string | null;
    },
) {
    const project = await lockProject(executor, input.projectId);
    if (!project) throw new Error("Project not found");
    const [appointment] = await executor
        .select()
        .from(projectGuidanceAppointments)
        .where(and(
            eq(projectGuidanceAppointments.projectId, input.projectId),
            eq(projectGuidanceAppointments.status, "active"),
        ))
        .for("update")
        .limit(1);
    if (!appointment) throw new Error("There is no active guidance appointment");

    const isLead = input.actorId === project.owner_id;
    const isGuide = input.actorId === appointment.guideUserId;
    if (!isLead && !isGuide) throw new Error("Only the project Lead or appointed person can end this appointment");
    if (!isLead && input.outcome !== "keep_member") {
        throw new Error("The project Lead chooses the membership outcome");
    }

    const now = new Date();
    await executor.update(projectGuidanceAppointments)
        .set({
            status: "ended",
            endedAt: now,
            endedBy: input.actorId,
            endReason: cleanOptionalText(input.reason, 500),
            updatedAt: now,
        })
        .where(eq(projectGuidanceAppointments.id, appointment.id));

    let lifecycle: Awaited<ReturnType<typeof changeProjectMemberRoleInternal>> | Awaited<ReturnType<typeof removeProjectMemberInternal>> | null = null;
    if (input.outcome === "remove") {
        lifecycle = await removeProjectMemberInternal(executor, {
            projectId: input.projectId,
            actorId: input.actorId,
            targetUserId: appointment.guideUserId,
            mode: input.removalMode ?? "preserve_history",
            reassignToUserId: input.reassignToUserId ?? null,
        });
    } else {
        const nextRole = input.outcome === "keep_admin"
            ? "admin"
            : input.outcome === "keep_member"
                ? "member"
                : appointment.previousMembershipRole === "admin" || appointment.previousMembershipRole === "member" || appointment.previousMembershipRole === "viewer"
                    ? appointment.previousMembershipRole
                    : "member";
        lifecycle = await changeProjectMemberRoleInternal(executor, {
            projectId: input.projectId,
            actorId: input.actorId,
            targetUserId: appointment.guideUserId,
            nextRole,
        });
    }

    await executor.insert(projectNodeEvents).values({
        projectId: input.projectId,
        actorId: input.actorId,
        nodeId: null,
        type: "project_guidance.ended",
        metadata: {
            appointmentId: appointment.id,
            guideUserId: appointment.guideUserId,
            label: appointment.label,
            outcome: input.outcome,
        },
        createdAt: now,
    });
    return { appointment, lifecycle };
}
