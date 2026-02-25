"use server";

import { db } from "@/lib/db";
import { projectFileIndex, projectNodeEvents, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, ilike, inArray } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
    assertProjectWriteAccess,
    assertValidParentFolder,
    assertUniqueSiblingName,
    assertNotMovingIntoDescendant,
    assertNodeNotLockedByAnotherUser,
    recordNodeEvent,
} from "./_shared";
import {
    normalizeNodeName,
    assertValidNodeName,
    assertBulkLimit,
    escapeLikePattern,
} from "./_constants";

export async function createFolder(projectId: string, parentId: string | null, name: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    const safeName = normalizeNodeName(name);
    assertValidNodeName(safeName);

    const node = await db.transaction(async (tx) => {
        await assertValidParentFolder(projectId, parentId, tx);
        await assertUniqueSiblingName(projectId, parentId, safeName, tx);
        const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId,
            type: 'folder',
            name: safeName,
            createdBy: user.id,
        }).returning();
        return created;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_folder', { parentId, name: safeName });
    revalidatePath(`/projects/${projectId}`); // Revalidate generally
    return node;
}

export async function createFileNode(projectId: string, parentId: string | null, file: {
    name: string;
    s3Key: string;
    size: number;
    mimeType: string;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    const safeName = normalizeNodeName(file.name);
    assertValidNodeName(safeName);

    const node = await db.transaction(async (tx) => {
        await assertValidParentFolder(projectId, parentId, tx);
        await assertUniqueSiblingName(projectId, parentId, safeName, tx);
        const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId,
            type: 'file',
            name: safeName,
            s3Key: file.s3Key,
            size: file.size,
            mimeType: file.mimeType,
            createdBy: user.id,
        }).returning();
        return created;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_file', { parentId, name: safeName, s3Key: file.s3Key });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function renameNode(nodeId: string, newName: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    const safeName = normalizeNodeName(newName);
    assertValidNodeName(safeName);

    const node = await db.transaction(async (tx) => {
        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);
        const current = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true, parentId: true, metadata: true, deletedAt: true },
        });

        if (!current || current.deletedAt) throw new Error("File not found");
        const isSystemFolder =
            !!current.metadata && (current.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot rename system folder");

        await assertUniqueSiblingName(projectId, current.parentId ?? null, safeName, tx, nodeId);
        const [updated] = await tx.update(projectNodes)
            .set({ name: safeName, updatedAt: new Date() })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
            .returning();
        return updated;
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'rename', { newName: safeName });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function moveNode(nodeId: string, newParentId: string | null, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const node = await db.transaction(async (tx) => {
        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);
        const current = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        });
        if (!current || current.deletedAt) throw new Error("Node not found");
        if (newParentId === current.parentId) return current;
        if (newParentId === nodeId) throw new Error("Cannot move node into itself");

        const isSystemFolder =
            !!current.metadata && (current.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot move system folder");

        await assertValidParentFolder(projectId, newParentId, tx);

        if (current.type === "folder") {
            await assertNotMovingIntoDescendant(projectId, nodeId, newParentId, tx);
        }

        await assertUniqueSiblingName(projectId, newParentId, current.name, tx, nodeId);

        const [updated] = await tx.update(projectNodes)
            .set({ parentId: newParentId, updatedAt: new Date() })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
            .returning();
        return updated;
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'move', { newParentId });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function bulkMoveNodes(nodeIds: string[], newParentId: string | null, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);

    const moved = await db.transaction(async (tx) => {
        await assertValidParentFolder(projectId, newParentId, tx);

        const nodes = await tx.query.projectNodes.findMany({
            where: and(
                eq(projectNodes.projectId, projectId),
                inArray(projectNodes.id, uniqueIds),
                isNull(projectNodes.deletedAt)
            ),
            columns: {
                id: true,
                parentId: true,
                name: true,
                type: true,
                metadata: true,
            },
        });

        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing or already deleted");
        }

        const targetNameSet = new Set<string>();
        for (const node of nodes) {
            await assertNodeNotLockedByAnotherUser(projectId, node.id, user.id, tx);
            const isSystemFolder =
                !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
            if (isSystemFolder) throw new Error(`Cannot move system folder: ${node.name}`);
            if (node.parentId === newParentId) continue;

            const lowName = node.name.toLowerCase();
            if (targetNameSet.has(lowName)) {
                throw new Error(`Duplicate name conflict in selection: ${node.name}`);
            }
            targetNameSet.add(lowName);

            if (node.type === "folder") {
                await assertNotMovingIntoDescendant(projectId, node.id, newParentId, tx);
            }
            await assertUniqueSiblingName(projectId, newParentId, node.name, tx, node.id);
        }

        const movedNodes: ProjectNode[] = [];
        for (const node of nodes) {
            if (node.parentId === newParentId) continue;
            const [updated] = await tx.update(projectNodes)
                .set({ parentId: newParentId, updatedAt: new Date() })
                .where(and(eq(projectNodes.id, node.id), eq(projectNodes.projectId, projectId)))
                .returning();
            movedNodes.push(updated);
        }

        if (movedNodes.length > 0) {
            await tx.insert(projectNodeEvents).values(
                movedNodes.map((node) => ({
                    projectId,
                    nodeId: node.id,
                    actorId: user.id,
                    type: "move",
                    metadata: { newParentId, bulk: true },
                    createdAt: new Date(),
                }))
            );
        }

        return movedNodes;
    });

    revalidatePath(`/projects/${projectId}`);
    return moved;
}

export async function trashNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    await db.transaction(async (tx) => {
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { metadata: true, s3Key: true, deletedAt: true }
        });
        if (!node) throw new Error("File not found");
        if (node.deletedAt) return;

        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);

        const isSystemFolder =
            !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot delete system folder");

        const now = new Date();
        await tx.update(projectNodes)
            .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));

        await tx.delete(projectFileIndex).where(eq(projectFileIndex.nodeId, nodeId));
        await tx.delete(projectNodeLocks).where(eq(projectNodeLocks.nodeId, nodeId));
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'trash', {});
    revalidatePath(`/projects/${projectId}`);
}

export async function restoreNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id);

    await db.update(projectNodes)
        .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));

    await recordNodeEvent(projectId, user.id, nodeId, 'restore', {});
    revalidatePath(`/projects/${projectId}`);
}

export async function bulkTrashNodes(nodeIds: string[], projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);

    const now = new Date();
    const result = await db.transaction(async (tx) => {
        const nodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, name: true, metadata: true, deletedAt: true },
        });
        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }

        for (const node of nodes) {
            await assertNodeNotLockedByAnotherUser(projectId, node.id, user.id, tx);
            const isSystemFolder =
                !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
            if (isSystemFolder) throw new Error(`Cannot delete system folder: ${node.name}`);
        }

        const toTrashIds = nodes.filter((n) => !n.deletedAt).map((n) => n.id);
        const alreadyTrashedIds = nodes.filter((n) => !!n.deletedAt).map((n) => n.id);

        if (toTrashIds.length > 0) {
            await tx.update(projectNodes)
                .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
                .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, toTrashIds)));

            await tx.delete(projectFileIndex).where(inArray(projectFileIndex.nodeId, toTrashIds));
            await tx.delete(projectNodeLocks).where(inArray(projectNodeLocks.nodeId, toTrashIds));

            await tx.insert(projectNodeEvents).values(
                toTrashIds.map((nodeId) => ({
                    projectId,
                    nodeId,
                    actorId: user.id,
                    type: "trash",
                    metadata: { bulk: true },
                    createdAt: now,
                }))
            );
        }

        return { trashedIds: toTrashIds, alreadyTrashedIds };
    });

    revalidatePath(`/projects/${projectId}`);
    return result;
}

export async function bulkRestoreNodes(nodeIds: string[], projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);

    const now = new Date();
    const result = await db.transaction(async (tx) => {
        const nodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, deletedAt: true },
        });
        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }

        for (const node of nodes) {
            await assertNodeNotLockedByAnotherUser(projectId, node.id, user.id, tx);
        }

        const toRestoreIds = nodes.filter((n) => !!n.deletedAt).map((n) => n.id);
        const alreadyActiveIds = nodes.filter((n) => !n.deletedAt).map((n) => n.id);

        if (toRestoreIds.length > 0) {
            await tx.update(projectNodes)
                .set({ deletedAt: null, deletedBy: null, updatedAt: now })
                .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, toRestoreIds)));

            await tx.insert(projectNodeEvents).values(
                toRestoreIds.map((nodeId) => ({
                    projectId,
                    nodeId,
                    actorId: user.id,
                    type: "restore",
                    metadata: { bulk: true },
                    createdAt: now,
                }))
            );
        }

        return { restoredIds: toRestoreIds, alreadyActiveIds };
    });

    revalidatePath(`/projects/${projectId}`);
    return result;
}

export async function getTrashNodes(projectId: string, query?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // Trash is an editing view; members only.
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const q = query?.trim();
    const whereClause = q
        ? and(eq(projectNodes.projectId, projectId), ilike(projectNodes.name, `%${escapeLikePattern(q)}%`), isNotNull(projectNodes.deletedAt))
        : and(eq(projectNodes.projectId, projectId), isNotNull(projectNodes.deletedAt));

    return await db.query.projectNodes.findMany({
        where: whereClause,
        orderBy: (nodes, { desc }) => [desc(nodes.deletedAt)],
        limit: 500,
    });
}

export async function purgeNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id);

    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { metadata: true, s3Key: true, deletedAt: true }
    });
    const isSystemFolder =
        !!node?.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
    if (isSystemFolder) throw new Error("Cannot delete system folder");
    if (!node?.deletedAt) throw new Error("Node must be in Trash before purging");

    await recordNodeEvent(projectId, user.id, nodeId, 'purge', {});
    await db.delete(projectNodes).where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));
    revalidatePath(`/projects/${projectId}`);
    return { s3Key: node.s3Key || null };
}

export async function deleteNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    await db.transaction(async (tx) => {
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { metadata: true }
        });
        if (!node) throw new Error("File not found");

        const isSystemFolder =
            !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot delete system folder");

        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);

        await tx.delete(projectFileIndex).where(eq(projectFileIndex.nodeId, nodeId));
        await tx.delete(projectNodeLocks).where(eq(projectNodeLocks.nodeId, nodeId));
        await tx.delete(projectNodes).where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'delete', {});
    revalidatePath(`/projects/${projectId}`);
}
