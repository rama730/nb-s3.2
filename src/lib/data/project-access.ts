import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import {
    isProjectPubliclyReadableVisibility,
    type ProjectVisibilityInput,
} from "@/lib/projects/project-visibility";
import { and, eq, isNull, inArray, or, sql, type SQL } from "drizzle-orm";

// `projects.visibility` has a database default but is not declared NOT NULL,
// so DB-selected values must remain nullable-safe and fail closed downstream.
type Visibility = ProjectVisibilityInput | null | undefined;
type Status = "draft" | "active" | "completed" | "archived" | string | null | undefined;
type MemberRole = "owner" | "admin" | "member" | "viewer" | null;

export type ProjectAccess = {
    project: {
        id: string;
        ownerId: string;
        visibility: Visibility;
        status: Status;
        slug?: string | null;
        publicTabVisibility?: unknown;
        importSource?: { type?: string | null } | null;
        syncStatus?: string | null;
    } | null;
    isOwner: boolean;
    isMember: boolean;
    memberRole: MemberRole;
    member: { role: MemberRole; fileUploadEnabled: boolean | null } | null;
    canRead: boolean;
    canWrite: boolean;
};

export function computeProjectReadAccess(
    visibility: Visibility,
    status: Status,
    isOwner: boolean,
    isMember: boolean,
): boolean {
    if (Boolean(isOwner) || Boolean(isMember)) return true;

    const normalizedStatus = typeof status === "string" && status.trim().length > 0 ? status : "draft";
    const isPublic = isProjectPubliclyReadableVisibility(visibility);
    const isDraft = normalizedStatus === "draft";

    if (isDraft) return false;
    return Boolean(isPublic);
}

export function computeProjectWriteAccess(isOwner: boolean, memberRole: MemberRole) {
    if (isOwner) return true;
    if (!memberRole) return false;
    return memberRole !== "viewer";
}

async function getProjectAccess(where: SQL<unknown>, userId: string | null): Promise<ProjectAccess> {
    const memberJoinCondition = userId
        ? and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId))
        : sql`FALSE`;

    const [row] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            status: projects.status,
            slug: projects.slug,
            publicTabVisibility: projects.publicTabVisibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
            memberRole: projectMembers.role,
            fileUploadEnabled: projectMembers.fileUploadEnabled,
        })
        .from(projects)
        .leftJoin(projectMembers, memberJoinCondition)
        .where(and(where, isNull(projects.deletedAt)))
        .limit(1);

    if (!row) {
        return {
            project: null,
            isOwner: false,
            isMember: false,
            memberRole: null,
            member: null,
            canRead: false,
            canWrite: false,
        };
    }

    const isOwner = Boolean(userId && row.ownerId === userId);
    let isMember = false;
    let memberRole: MemberRole = null;
    let member: ProjectAccess["member"] = null;

    if (userId && !isOwner && row.memberRole) {
        isMember = true;
        memberRole = (row.memberRole as MemberRole) || "member";
        member = { role: memberRole, fileUploadEnabled: row.fileUploadEnabled };
    }

    const project = {
        id: row.id,
        ownerId: row.ownerId,
        visibility: row.visibility,
        status: row.status,
        slug: row.slug,
        publicTabVisibility: row.publicTabVisibility,
        importSource: row.importSource,
        syncStatus: row.syncStatus,
    };

    const canRead = computeProjectReadAccess(project.visibility, project.status, isOwner, isMember);
    const canWrite = computeProjectWriteAccess(isOwner, memberRole);

    return {
        project,
        isOwner,
        isMember,
        memberRole,
        member,
        canRead,
        canWrite,
    };
}

export function getProjectAccessById(projectId: string, userId: string | null): Promise<ProjectAccess> {
    return getProjectAccess(eq(projects.id, projectId), userId);
}

export function getProjectAccessByIdentifier(identifier: string, userId: string | null): Promise<ProjectAccess> {
    const value = identifier.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    return getProjectAccess(isUuid ? or(eq(projects.slug, value), eq(projects.id, value))! : eq(projects.slug, value), userId);
}

export async function getProjectAccessByIds(projectIds: string[], userId: string | null): Promise<Record<string, ProjectAccess>> {
    if (projectIds.length === 0) return {};
    
    const projectsData = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            status: projects.status,
            slug: projects.slug,
            publicTabVisibility: projects.publicTabVisibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
        })
        .from(projects)
        .where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt)));

    const projectMemberships = userId ? await db
        .select({ projectId: projectMembers.projectId, role: projectMembers.role, fileUploadEnabled: projectMembers.fileUploadEnabled })
        .from(projectMembers)
        .where(and(inArray(projectMembers.projectId, projectIds), eq(projectMembers.userId, userId))) : [];

    const membershipsByProject = Object.fromEntries(projectMemberships.map(m => [m.projectId, m]));

    const result: Record<string, ProjectAccess> = {};
    for (const project of projectsData) {
        let isOwner = false;
        let isMember = false;
        let memberRole: MemberRole = null;
        let memberFileUploadEnabled: boolean | null = null;

        if (userId) {
            isOwner = project.ownerId === userId;
            if (!isOwner) {
                const member = membershipsByProject[project.id];
                if (member) {
                    isMember = true;
                    memberRole = (member.role as MemberRole) || "member";
                    memberFileUploadEnabled = member.fileUploadEnabled;
                }
            }
        }
        result[project.id] = {
            project,
            isOwner,
            isMember,
            memberRole,
            member: isMember ? { role: memberRole, fileUploadEnabled: memberFileUploadEnabled } : null,
            canRead: computeProjectReadAccess(project.visibility, project.status, isOwner, isMember),
            canWrite: computeProjectWriteAccess(isOwner, memberRole),
        };
    }
    return result;
}
