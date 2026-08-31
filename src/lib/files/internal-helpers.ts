import { db } from "@/lib/db";
import { projectMembers, projectNodeEvents, projectNodeLocks, projectNodes, projects, tasks } from "@/lib/db/schema";
import { getProjectAccessById, type ProjectAccess } from "@/lib/data/project-access";
import { eq, and, isNull, sql, ne, gt, type SQL } from "drizzle-orm";
import { isWithParent } from "@/app/actions/files/_constants";
import { requireProjectCapability } from "@/lib/projects/collaborator-lifecycle";
import { canProjectMemberUploadFiles, isProjectTabVisibleToViewer, projectMemberCan } from "@/lib/projects/settings-policies";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExistingProjectAccess = ProjectAccess & { project: NonNullable<ProjectAccess["project"]> };

async function getProjectAccess(projectId: string, userId: string | null): Promise<ExistingProjectAccess> {
    const access = await getProjectAccessById(projectId, userId);
    if (!access.project) throw new Error("Project not found");
    return access as ExistingProjectAccess;
}

export async function assertProjectAccess(projectId: string, userId: string) {
    await assertProjectReadAccess(projectId, userId);
}

export async function assertProjectReadAccess(projectId: string, userId: string | null) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canRead) throw new Error("Forbidden");
    return access;
}

export async function assertProjectFileReadAccess(projectId: string, userId: string | null) {
    const access = await assertProjectReadAccess(projectId, userId);
    const isOwnerOrMember = access.isOwner || access.isMember;
    if (!isProjectTabVisibleToViewer({
        tabId: "files",
        isOwnerOrMember,
        publicTabVisibility: access.project.publicTabVisibility,
    })) {
        throw new Error("Files are members-only for this project.");
    }
    return access;
}

/** Files visibility does not implicitly publish task-only attachments. */
export function canReadProjectTaskFiles(access: ExistingProjectAccess): boolean {
    return isProjectTabVisibleToViewer({
        tabId: "tasks",
        isOwnerOrMember: access.isOwner || access.isMember,
        publicTabVisibility: access.project.publicTabVisibility,
    });
}

export function assertTaskFileNodeVisible(access: ExistingProjectAccess, node: { taskId?: string | null; path?: string | null; deletedAt?: unknown }) {
    if (node.deletedAt) throw new Error("File not found");
    if ((node.taskId || node.path?.startsWith("/.system/")) && !canReadProjectTaskFiles(access)) {
        throw new Error("Task files are not available to this viewer.");
    }
}

export async function assertProjectWriteAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new Error("Forbidden");
    await requireProjectCapability(projectId, userId, "upload_files");
    return { ...access, canWrite: true };
}

export async function assertProjectManageFilesAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new Error("Forbidden");
    await requireProjectCapability(projectId, userId, "manage_files");
    return { ...access, canManageFiles: true };
}

export async function assertProjectUploadAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (access.isOwner) return { ...access, canUpload: true };
    const [member] = access.isMember
        ? await db
            .select({ fileUploadEnabled: projectMembers.fileUploadEnabled })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
            .limit(1)
        : [];
    if (!canProjectMemberUploadFiles({ role: access.memberRole, fileUploadEnabled: member?.fileUploadEnabled ?? null })) {
        throw new Error("File uploads are disabled for this project member.");
    }
    return { ...access, canUpload: true };
}

export async function assertProjectWriteAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at
        FROM projects
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) {
        throw new Error("Forbidden");
    }

    const isOwner = project.owner_id === userId;
    if (isOwner) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null }>(sql`
        SELECT role
        FROM project_members
        WHERE project_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member) {
        throw new Error("Forbidden");
    }
    if (!projectMemberCan(member.role, "upload_files")) {
        throw new Error("Forbidden");
    }

    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function assertProjectManageFilesAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at
        FROM projects
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) throw new Error("Forbidden");
    if (project.owner_id === userId) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null }>(sql`
        SELECT role
        FROM project_members
        WHERE project_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member || !projectMemberCan(member.role, "manage_files")) throw new Error("Forbidden");
    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function assertProjectUploadAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at
        FROM projects
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) {
        throw new Error("Forbidden");
    }

    const isOwner = project.owner_id === userId;
    if (isOwner) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null; file_upload_enabled: boolean | null }>(sql`
        SELECT role, file_upload_enabled
        FROM project_members
        WHERE project_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member || !canProjectMemberUploadFiles({ role: member.role, fileUploadEnabled: member.file_upload_enabled })) {
        throw new Error("File uploads are disabled for this project member.");
    }

    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function getTaskProjectId(taskId: string): Promise<string> {
    const rows = await db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

    const projectId = rows[0]?.projectId;
    if (!projectId) throw new Error("Task not found");
    return projectId;
}

export async function ensureSystemRootFolder(projectId: string, userId: string, fallbackName: string) {
    return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`files-system-root:${projectId}`}))`);

        const existing = await tx.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.parentId),
                eq(projectNodes.type, "folder"),
                isNull(projectNodes.deletedAt),
                sql`coalesce(${projectNodes.metadata}->>'isSystem', 'false') = 'true'`
            ),
        });
        if (existing) return existing;

        const [created] = await tx
            .insert(projectNodes)
            .values({
                projectId,
                parentId: null,
                type: "folder",
                name: fallbackName,
                createdBy: userId,
                metadata: { isSystem: true },
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        return created;
    });
}

export async function assertNodeNotLockedByAnotherUser(
    projectId: string,
    nodeId: string,
    userId: string,
    tx: { query: typeof db.query } = db
) {
    const now = new Date();
    const lock = await tx.query.projectNodeLocks.findFirst({
        where: and(
            eq(projectNodeLocks.projectId, projectId),
            eq(projectNodeLocks.nodeId, nodeId),
            ne(projectNodeLocks.lockedBy, userId),
            gt(projectNodeLocks.expiresAt, now)
        ),
        columns: { lockedBy: true, expiresAt: true },
    });

    if (lock) {
        throw new Error("File has an active editing lease");
    }
}

export async function assertValidParentFolder(projectId: string, parentId: string | null, tx: { query: typeof db.query } = db) {
    if (!parentId) return null;
    const parent = await tx.query.projectNodes.findFirst({
        where: and(
            eq(projectNodes.id, parentId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt)
        ),
        columns: { id: true, type: true, parentId: true, path: true, taskId: true, metadata: true }
    });
    if (!parent) throw new Error("Destination folder not found");
    if (parent.type !== 'folder') throw new Error("Destination must be a folder");
    return parent;
}

export async function assertValidMoveDestination(
    projectId: string,
    parentId: string | null,
    sourceTaskId: string | null,
    tx: { query: typeof db.query } = db,
) {
    if (sourceTaskId) {
        throw new Error("Task working files must be published to Project Files before they can be relocated");
    }
    const parent = await assertValidParentFolder(projectId, parentId, tx);
    if (!parent) return null;
    const isSystem =
        parent.path === "/.system" ||
        parent.path.startsWith("/.system/") ||
        (parent.metadata as { isSystem?: unknown } | null)?.isSystem === true;
    if (isSystem || parent.taskId) {
        throw new Error("The internal task workspace cannot be used as a destination");
    }
    return parent;
}

export async function assertUniqueSiblingName(
    projectId: string,
    parentId: string | null,
    name: string,
    tx: { query: typeof db.query } = db,
    ignoreNodeId?: string
) {
    const conditions: SQL[] = [
        eq(projectNodes.projectId, projectId),
        isWithParent(parentId),
        isNull(projectNodes.deletedAt),
        sql`lower(${projectNodes.name}) = lower(${name})`,
    ];
    if (ignoreNodeId) {
        conditions.push(ne(projectNodes.id, ignoreNodeId));
    }

    const duplicate = await tx.query.projectNodes.findFirst({
        where: and(...conditions),
        columns: { id: true },
    });

    if (duplicate) {
        throw new Error("A file/folder with this name already exists in this location");
    }
}

export async function assertNotMovingIntoDescendant(
    projectId: string,
    nodeId: string,
    targetParentId: string | null,
    tx: { query: typeof db.query } = db
) {
    let cursor = targetParentId;
    const visited = new Set<string>();
    for (let depth = 0; cursor; depth++) {
        if (depth >= 256 || visited.has(cursor)) {
            throw new Error("Folder hierarchy is inconsistent; move cancelled");
        }
        visited.add(cursor);
        if (cursor === nodeId) {
            throw new Error("Cannot move a folder into itself or its descendant");
        }
        const next = await tx.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.id, cursor),
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.deletedAt),
            ),
            columns: { parentId: true },
        });
        if (!next) throw new Error("Destination folder not found");
        cursor = next.parentId;
    }
}

export async function recordNodeEvent(
    projectId: string,
    actorId: string | null,
    nodeId: string | null,
    type: string,
    metadata: Record<string, unknown> = {},
    clientTx?: DbTransaction
) {
    const run = async (tx: any) => {
        const [project] = await tx
            .update(projects)
            .set({
                currentSequenceNumber: sql`${projects.currentSequenceNumber} + 1`
            })
            .where(eq(projects.id, projectId))
            .returning({
                newSequenceNumber: projects.currentSequenceNumber
            });

        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        const [event] = await tx
            .insert(projectNodeEvents)
            .values({
                projectId,
                actorId,
                nodeId,
                type,
                sequenceNumber: project.newSequenceNumber,
                metadata,
                createdAt: new Date(),
            })
            .returning();

        return { sequenceNumber: project.newSequenceNumber, event };
    };

    if (clientTx) {
        return await run(clientTx);
    }
    return await db.transaction(async (tx) => {
        return await run(tx);
    });
}
