"use server";

import { db } from "@/lib/db";
import { projectFileIndex, projectNodeEvents, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, or, isNull, isNotNull, ilike, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { buildProjectFileKey, isCanonicalProjectFileKey, parseProjectFileKey } from "@/lib/storage/project-file-key";
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    normalizeAndValidateUploadRelativePath,
    PROJECT_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/upload/security";
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

async function getParentPath(tx: any, projectId: string, parentId: string | null): Promise<string> {
    if (!parentId) return "";
    const parent = await tx.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, parentId), eq(projectNodes.projectId, projectId)),
        columns: { path: true }
    });
    return parent?.path || "";
}

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
        const parentPath = await getParentPath(tx, projectId, parentId);
        const nodePath = `${parentPath}/${safeName}`;

        const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId,
            type: 'folder',
            name: safeName,
            path: nodePath,
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
    const parsedKey = parseProjectFileKey(file.s3Key);
    if (!parsedKey || !isCanonicalProjectFileKey(file.s3Key) || parsedKey.projectId !== projectId) {
        throw new Error("Invalid file storage key");
    }
    const normalizedRelativePath = normalizeAndValidateUploadRelativePath(parsedKey.relativePath);
    const canonicalS3Key = buildProjectFileKey(projectId, normalizedRelativePath);
    const normalizedSize = normalizeAndValidateFileSize(file.size, PROJECT_UPLOAD_MAX_FILE_BYTES);
    const normalizedMimeType = normalizeAndValidateMimeType(file.mimeType);

    const node = await db.transaction(async (tx) => {
        await assertValidParentFolder(projectId, parentId, tx);
        await assertUniqueSiblingName(projectId, parentId, safeName, tx);
        const parentPath = await getParentPath(tx, projectId, parentId);
        const nodePath = `${parentPath}/${safeName}`;

        const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId,
            type: 'file',
            name: safeName,
            path: nodePath,
            s3Key: canonicalS3Key,
            size: normalizedSize,
            mimeType: normalizedMimeType,
            createdBy: user.id,
        }).returning();
        return created;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_file', { parentId, name: safeName, s3Key: canonicalS3Key });
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
            columns: { id: true, parentId: true, metadata: true, deletedAt: true, path: true, type: true },
        });

        if (!current || current.deletedAt) throw new Error("File not found");
        const isSystemFolder =
            !!current.metadata && (current.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot rename system folder");

        await assertUniqueSiblingName(projectId, current.parentId ?? null, safeName, tx, nodeId);

        const parentPath = await getParentPath(tx, projectId, current.parentId ?? null);
        const newPath = `${parentPath}/${safeName}`;
        const oldPath = current.path;

        const [updated] = await tx.update(projectNodes)
            .set({ name: safeName, path: newPath, updatedAt: new Date() })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
            .returning();

        // If it's a folder, update all descendants paths
        if (current.type === 'folder' && oldPath) {
            const escapedOldPath = oldPath.replace(/[\\%_]/g, "\\$&");
            const likePattern = `${escapedOldPath}/%`;
            await tx.execute(sql`
                UPDATE project_nodes 
                SET path = ${newPath} || SUBSTRING(path FROM ${oldPath.length + 1})
                WHERE project_id = ${projectId} AND path LIKE ${likePattern} ESCAPE '\\'
            `);
        }

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

        const newParentPath = await getParentPath(tx, projectId, newParentId);
        const newPath = `${newParentPath}/${current.name}`;
        const oldPath = current.path;

        const [updated] = await tx.update(projectNodes)
            .set({ parentId: newParentId, path: newPath, updatedAt: new Date() })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
            .returning();

        if (current.type === 'folder' && oldPath) {
            await tx.execute(sql`
                UPDATE project_nodes 
                SET path = ${newPath} || SUBSTRING(path FROM ${oldPath.length + 1})
                WHERE project_id = ${projectId} AND path LIKE ${oldPath + '/%'}
            `);
        }

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

export async function bulkCreateFolderTree(
    projectId: string,
    targetParentId: string | null,
    files: { path: string; name: string; size: number; mimeType: string }[]
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    if (files.length === 0) return [];
    if (files.length > 5000) throw new Error("Maximum 5000 files allowed per bulk upload block.");
    const normalizedFiles = files.map((file) => {
        const normalizedPath = normalizeAndValidateUploadRelativePath(file.path);
        const normalizedSize = normalizeAndValidateFileSize(file.size, PROJECT_UPLOAD_MAX_FILE_BYTES);
        const normalizedMimeType = normalizeAndValidateMimeType(file.mimeType);
        return {
            path: normalizedPath,
            name: file.name,
            size: normalizedSize,
            mimeType: normalizedMimeType,
        };
    });

    // 1. Parse all implicit folders from the file paths
    const folderPaths = new Set<string>();
    for (const f of normalizedFiles) {
        const parts = f.path.split('/');
        parts.pop(); // Remove the file name
        let cur = "";
        for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            folderPaths.add(cur);
        }
    }

    // Sort folders by depth so we create parents before children
    const sortedFolders = Array.from(folderPaths).sort((a, b) => a.split('/').length - b.split('/').length);

    return await db.transaction(async (tx) => {
        await assertValidParentFolder(projectId, targetParentId, tx);

        // Map: virtual path -> physical node ID
        const pathToId = new Map<string, string>();
        // Map: virtual path -> materialized node path (for DB `path` column)
        const pathToNodePath = new Map<string, string>();
        if (targetParentId) {
            pathToId.set("", targetParentId);
            const parentPath = await getParentPath(tx, projectId, targetParentId);
            pathToNodePath.set("", parentPath);
        } else {
            pathToNodePath.set("", "");
        }

        // 2. Resolve / Create all folders layer by layer (Strict O(Depth) operations)
        const foldersByDepth: Record<number, string[]> = {};
        for (const folderPath of sortedFolders) {
            const depth = folderPath.split('/').length;
            if (!foldersByDepth[depth]) foldersByDepth[depth] = [];
            foldersByDepth[depth].push(folderPath);
        }
        const maxDepth = Math.max(0, ...Object.keys(foldersByDepth).map(Number));

        for (let depth = 1; depth <= maxDepth; depth++) {
            const paths = foldersByDepth[depth];
            if (!paths || paths.length === 0) continue;

            const nodesToFindOrCreate = paths.map(path => {
                const parts = path.split('/');
                const name = parts[parts.length - 1];
                const safeName = normalizeNodeName(name);
                assertValidNodeName(safeName);
                const parentVirtualPath = parts.slice(0, -1).join('/');
                const parentId = targetParentId
                    ? (parentVirtualPath ? pathToId.get(parentVirtualPath) : targetParentId)
                    : (parentVirtualPath ? pathToId.get(parentVirtualPath) : null);
                return { path, safeName, parentId: parentId || null };
            });

            const parentIdsAtDepth = Array.from(new Set(nodesToFindOrCreate.map(n => n.parentId).filter(Boolean))) as string[];
            const namesAtDepth = Array.from(new Set(nodesToFindOrCreate.map(n => n.safeName)));

            let existingFolders: { id: string, name: string, parentId: string | null, path: string }[] = [];

            if (namesAtDepth.length > 0) {
                // Find existing folders at this exact depth level
                const conditions = [
                    eq(projectNodes.projectId, projectId),
                    eq(projectNodes.type, 'folder'),
                    isNull(projectNodes.deletedAt),
                    inArray(projectNodes.name, namesAtDepth)
                ];

                if (parentIdsAtDepth.length > 0) {
                    const hasNullParent = nodesToFindOrCreate.some(n => n.parentId === null);
                    if (hasNullParent) {
                        conditions.push(or(inArray(projectNodes.parentId, parentIdsAtDepth), isNull(projectNodes.parentId))!);
                    } else {
                        conditions.push(inArray(projectNodes.parentId, parentIdsAtDepth));
                    }
                } else {
                    conditions.push(isNull(projectNodes.parentId));
                }

                existingFolders = await tx.query.projectNodes.findMany({
                    where: and(...conditions),
                    columns: { id: true, name: true, parentId: true, path: true }
                });
            }

            const newFolderInserts: (typeof projectNodes.$inferInsert)[] = [];
            const newFolderPaths: string[] = [];

            for (const node of nodesToFindOrCreate) {
                const existing = existingFolders.find(e => e.name === node.safeName && e.parentId === node.parentId);
                const parentVirtualPath = node.path.split('/').slice(0, -1).join('/');
                const parentNodePath = pathToNodePath.get(parentVirtualPath) || "";
                const nodePath = `${parentNodePath}/${node.safeName}`;
                if (existing) {
                    pathToId.set(node.path, existing.id);
                    pathToNodePath.set(node.path, existing.path || nodePath);
                } else {
                    newFolderInserts.push({
                        projectId,
                        parentId: node.parentId,
                        type: 'folder',
                        name: node.safeName,
                        path: nodePath,
                        createdBy: user.id
                    });
                    newFolderPaths.push(node.path);
                    pathToNodePath.set(node.path, nodePath);
                }
            }

            if (newFolderInserts.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < newFolderInserts.length; i += chunkSize) {
                    const chunk = newFolderInserts.slice(i, i + chunkSize);
                    const inserted = await tx.insert(projectNodes).values(chunk).returning({ id: projectNodes.id });
                    for (let j = 0; j < chunk.length; j++) {
                        pathToId.set(newFolderPaths[i + j], inserted[j].id);
                    }
                }
            }
        }

        // 3. Batch insert all files in one massive query
        const fileInserts: (typeof projectNodes.$inferInsert)[] = [];
        const resultMappings: { path: string; fileId: string; s3Key: string; name: string }[] = [];

        for (const f of normalizedFiles) {
            const parts = f.path.split('/');
            const name = parts.pop() || "unknown";
            const safeName = normalizeNodeName(name);
            assertValidNodeName(safeName);
            const parentVirtualPath = parts.join('/');

            const parentId = targetParentId ? (parentVirtualPath ? pathToId.get(parentVirtualPath) : targetParentId) : (parentVirtualPath ? pathToId.get(parentVirtualPath) : null);
            const fileExt = safeName.includes(".") ? safeName.split(".").pop() : "bin";
            const s3Key = buildProjectFileKey(projectId, `${randomUUID()}.${fileExt}`);

            const parentNodePath = parentVirtualPath ? (pathToNodePath.get(parentVirtualPath) || "") : (pathToNodePath.get("") || "");
            const filePath = `${parentNodePath}/${safeName}`;

            fileInserts.push({
                projectId,
                parentId: parentId || null,
                type: 'file',
                name: safeName,
                path: filePath,
                s3Key: s3Key,
                size: f.size,
                mimeType: f.mimeType,
                createdBy: user.id
            });
        }

        // Drizzle allows massive batch inserts
        if (fileInserts.length > 0) {
            // Chunk inserts if extremely large (e.g. > 1000 parameters)
            const chunkSize = 500;
            for (let i = 0; i < fileInserts.length; i += chunkSize) {
                const chunk = fileInserts.slice(i, i + chunkSize);
                const inserted = await tx.insert(projectNodes).values(chunk).returning({ id: projectNodes.id, s3Key: projectNodes.s3Key, name: projectNodes.name });

                for (let j = 0; j < chunk.length; j++) {
                    resultMappings.push({
                        path: normalizedFiles[i + j].path,
                        fileId: inserted[j].id,
                        s3Key: inserted[j].s3Key!,
                        name: inserted[j].name
                    });
                }
            }
        }

        return resultMappings;
    });
}
