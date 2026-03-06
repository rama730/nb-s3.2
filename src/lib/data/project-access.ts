import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type Visibility = "public" | "private" | "unlisted" | string | null | undefined;
type Status = "draft" | "active" | "completed" | "archived" | string | null | undefined;
type MemberRole = "owner" | "admin" | "member" | "viewer" | null;

export type ProjectAccess = {
    project: {
        id: string;
        ownerId: string;
        visibility: Visibility;
        status: Status;
        slug?: string | null;
    } | null;
    isOwner: boolean;
    isMember: boolean;
    memberRole: MemberRole;
    canRead: boolean;
    canWrite: boolean;
};

export function computeProjectReadAccess(visibility: Visibility, status: Status, isOwner: boolean, isMember: boolean) {
    if (isOwner || isMember) return true;

    const normalizedVisibility = visibility || "private";
    const normalizedStatus = status || "draft";
    const isPublic = normalizedVisibility === "public" || normalizedVisibility === "unlisted";
    const isDraft = normalizedStatus === "draft";

    if (isDraft) return false;
    return isPublic;
}

export function computeProjectWriteAccess(isOwner: boolean, memberRole: MemberRole) {
    if (isOwner) return true;
    if (!memberRole) return false;
    return memberRole !== "viewer";
}

export async function getProjectAccessById(projectId: string, userId: string | null): Promise<ProjectAccess> {
    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            status: projects.status,
            slug: projects.slug,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

    if (!project) {
        return {
            project: null,
            isOwner: false,
            isMember: false,
            memberRole: null,
            canRead: false,
            canWrite: false,
        };
    }

    let isOwner = false;
    let isMember = false;
    let memberRole: MemberRole = null;

    if (userId) {
        isOwner = project.ownerId === userId;
        if (!isOwner) {
            const [member] = await db
                .select({ role: projectMembers.role })
                .from(projectMembers)
                .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
                .limit(1);

            if (member) {
                isMember = true;
                memberRole = (member.role as MemberRole) || "member";
            }
        }
    }

    const canRead = computeProjectReadAccess(project.visibility, project.status, isOwner, isMember);
    const canWrite = computeProjectWriteAccess(isOwner, memberRole);

    return {
        project,
        isOwner,
        isMember,
        memberRole,
        canRead,
        canWrite,
    };
}
