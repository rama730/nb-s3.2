"use server";

import { db } from "@/lib/db";
import { projectMembers, projectNodeEvents, projectNodeLocks, projectNodes, projects, tasks } from "@/lib/db/schema";
import { eq, and, isNull, sql, ne, gt, type SQL } from "drizzle-orm";
import { isWithParent } from "./_constants";

async function getProjectAccess(projectId: string, userId: string | null) {
    const rows = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    const project = rows[0];
    if (!project) throw new Error("Project not found");

    const isPublic = project.visibility === 'public';
    if (!userId) {
        return { project, canRead: isPublic, canWrite: false };
    }

    if (project.ownerId === userId) return { project, canRead: true, canWrite: true };

    const member = await db
        .select({ id: projectMembers.id, role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .limit(1);

    if (member.length > 0) {
        const role = member[0]?.role;
        const canWrite = role !== 'viewer';
        return { project, canRead: true, canWrite };
    }

    return { project, canRead: isPublic, canWrite: false };
}

export async function assertProjectAccess(projectId: string, userId: string) {
    await assertProjectReadAccess(projectId, userId);
}

export async function assertProjectReadAccess(projectId: string, userId: string | null) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canRead) throw new Error("Forbidden");
    return access;
}

export async function assertProjectWriteAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new Error("Forbidden");
    return access;
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
            gt(projectNodeLocks.expiresAt, now)
        ),
        columns: { lockedBy: true, expiresAt: true },
    });

    if (lock && lock.lockedBy !== userId) {
        throw new Error("File is locked by another collaborator");
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
        columns: { id: true, type: true, parentId: true }
    });
    if (!parent) throw new Error("Destination folder not found");
    if (parent.type !== 'folder') throw new Error("Destination must be a folder");
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
    for (let depth = 0; cursor && depth < 256; depth++) {
        if (cursor === nodeId) {
            throw new Error("Cannot move a folder into itself or its descendant");
        }
        const next = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, cursor), eq(projectNodes.projectId, projectId)),
            columns: { parentId: true },
        });
        if (!next) break;
        cursor = next.parentId;
    }
}

export async function recordNodeEvent(projectId: string, actorId: string | null, nodeId: string | null, type: string, metadata: Record<string, unknown> = {}) {
    await db.insert(projectNodeEvents).values({
        projectId,
        actorId,
        nodeId,
        type,
        metadata,
        createdAt: new Date(),
    });
}
