"use server";

import { db } from "@/lib/db";
import { projectFileIndex, projectNodeEvents, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, or, isNull, isNotNull, ilike, inArray, sql, gt, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { buildProjectFileKey, isCanonicalProjectFileKey, parseProjectFileKey } from "@/lib/storage/project-file-key";
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    normalizeAndValidateUploadRelativePath,
    PROJECT_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/upload/security";
import { finalizeUploadIntent } from "@/lib/upload/upload-intents";
import {
    assertProjectWriteAccess,
    assertProjectWriteAccessTx,
    assertProjectUploadAccess,
    assertProjectUploadAccessTx,
    assertValidParentFolder,
    assertUniqueSiblingName,
    assertNotMovingIntoDescendant,
    assertNodeNotLockedByAnotherUser,
    recordNodeEvent,
} from "@/lib/files/internal-helpers";
import {
    normalizeNodeName,
    assertValidNodeName,
    assertBulkLimit,
    escapeLikePattern,
} from "./_constants";

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function enqueueFileNotificationBestEffort(input: Parameters<typeof enqueueProjectNotificationEvent>[0]) {
    try {
        await enqueueProjectNotificationEvent(input);
    } catch (error) {
        logger.warn("project_files.notification_enqueue_failed", {
            module: "files",
            projectId: input.projectId,
            eventKey: input.eventKey,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function getParentPath(tx: any, projectId: string, parentId: string | null): Promise<string> {
    if (!parentId) return "";
    const parent = await tx.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, parentId), eq(projectNodes.projectId, projectId)),
        columns: { path: true }
    });
    return parent?.path || "";
}

function descendantLikePattern(path: string): string {
    return `${escapeLikePattern(path)}/%`;
}

function subtreePathPredicate(node: { id: string; path: string; type: string }): SQL {
    const predicates: SQL[] = [eq(projectNodes.id, node.id)];
    if (node.type === "folder" && node.path) {
        predicates.push(sql`${projectNodes.path} LIKE ${descendantLikePattern(node.path)} ESCAPE '\\'`);
    }
    return or(...predicates) ?? sql`FALSE`;
}

function activeSubtreeWhere(projectId: string, node: { id: string; path: string; type: string }): SQL {
    return and(
        eq(projectNodes.projectId, projectId),
        isNull(projectNodes.deletedAt),
        subtreePathPredicate(node)
    ) ?? sql`FALSE`;
}

async function updateFolderDescendantPaths(
    tx: any,
    projectId: string,
    oldPath: string,
    newPath: string,
) {
    if (!oldPath) return;
    await tx.execute(sql`
        UPDATE project_nodes
        SET path = ${newPath} || SUBSTRING(path FROM ${oldPath.length + 1}),
            updated_at = NOW()
        WHERE project_id = ${projectId}
          AND path LIKE ${descendantLikePattern(oldPath)} ESCAPE '\\'
    `);
}

async function assertSubtreeNotLockedByAnotherUser(
    tx: any,
    projectId: string,
    node: { id: string; path: string; type: string },
    userId: string,
) {
    void userId;
    const [lock] = await tx
        .select({ nodeId: projectNodeLocks.nodeId })
        .from(projectNodeLocks)
        .innerJoin(projectNodes, eq(projectNodeLocks.nodeId, projectNodes.id))
        .where(and(
            eq(projectNodeLocks.projectId, projectId),
            gt(projectNodeLocks.expiresAt, new Date()),
            subtreePathPredicate(node)
        ))
        .limit(1);

    if (lock) {
        throw new Error("A file in this subtree has an active editing lease");
    }
}

export async function createFolder(projectId: string, parentId: string | null, name: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id);

    const safeName = normalizeNodeName(name);
    assertValidNodeName(safeName);

    const node = await db.transaction(async (tx) => {
        await assertProjectUploadAccessTx(tx, projectId, user.id);
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
        return created!;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_folder', { parentId, name: safeName });
    revalidatePath(`/projects/${projectId}`); // Revalidate generally
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.folder_created",
        title: `Folder created: ${safeName}`,
        body: "A new folder was added to the project workspace.",
        sourceEventId: node.id,
        entityRefs: { projectId, fileId: node.id },
    });
    return node;
}

export async function createFileNode(projectId: string, parentId: string | null, file: {
    name: string;
    s3Key: string;
    size: number;
    mimeType: string;
    uploadIntentId?: string;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id);

    const safeName = normalizeNodeName(file.name);
    assertValidNodeName(safeName);
    const finalizedIntent = await finalizeUploadIntent({
        intentId: file.uploadIntentId,
        storageKey: file.s3Key,
        bucket: 'project-files',
        userId: user.id,
        projectId,
        expectedScope: 'project_file',
        expectedKind: 'file',
    });

    const parsedKey = parseProjectFileKey(finalizedIntent.storageKey);
    if (!parsedKey || !isCanonicalProjectFileKey(finalizedIntent.storageKey) || parsedKey.projectId !== projectId) {
        throw new Error("Invalid file storage key");
    }
    const normalizedRelativePath = normalizeAndValidateUploadRelativePath(parsedKey.relativePath);
    const canonicalS3Key = buildProjectFileKey(projectId, normalizedRelativePath);
    const normalizedSize = normalizeAndValidateFileSize(finalizedIntent.finalizedSize ?? file.size, PROJECT_UPLOAD_MAX_FILE_BYTES);
    const normalizedMimeType = normalizeAndValidateMimeType(finalizedIntent.finalizedMimeType ?? file.mimeType);

    const node = await db.transaction(async (tx) => {
        await assertProjectUploadAccessTx(tx, projectId, user.id);
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
        return created!;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_file', { parentId, name: safeName, s3Key: canonicalS3Key });
    revalidatePath(`/projects/${projectId}`);
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.uploaded",
        title: `File uploaded: ${safeName}`,
        body: "A file was added to the project workspace.",
        sourceEventId: node.id,
        entityRefs: { projectId, fileId: node.id },
    });
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
        await assertProjectWriteAccessTx(tx, projectId, user.id);
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

        await updateFolderDescendantPaths(tx, projectId, oldPath, newPath);

        return updated!;
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'rename', { newName: safeName });
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.organized",
        title: `File renamed: ${safeName}`,
        body: "A project file or folder was renamed.",
        sourceEventId: `${nodeId}:rename:${safeName}`,
        entityRefs: { projectId, fileId: nodeId },
    });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function moveNode(nodeId: string, newParentId: string | null, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const node = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
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

        if (current.type === 'folder') {
            await updateFolderDescendantPaths(tx, projectId, oldPath, newPath);
        }

        return updated!;
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'move', { newParentId });
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.organized",
        title: `File moved: ${node.name}`,
        body: "A project file or folder was moved.",
        sourceEventId: `${nodeId}:move:${newParentId ?? "root"}`,
        entityRefs: { projectId, fileId: nodeId },
    });
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
        await assertProjectWriteAccessTx(tx, projectId, user.id);
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
                path: true,
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

        const selectedFolders = nodes.filter((node) => node.type === "folder");
        for (const node of nodes) {
            const selectedAncestor = selectedFolders.find((folder) =>
                folder.id !== node.id && node.path.startsWith(`${folder.path}/`)
            );
            if (selectedAncestor) {
                throw new Error(`Selection contains both "${selectedAncestor.name}" and one of its descendants. Select the top-level folder only.`);
            }
        }

        const movedNodes: ProjectNode[] = [];
        const newParentPath = await getParentPath(tx, projectId, newParentId);
        const now = new Date();
        for (const node of nodes) {
            if (node.parentId === newParentId) continue;
            const oldPath = node.path;
            const newPath = `${newParentPath}/${node.name}`;
            const [updated] = await tx.update(projectNodes)
                .set({ parentId: newParentId, path: newPath, updatedAt: now })
                .where(and(eq(projectNodes.id, node.id), eq(projectNodes.projectId, projectId)))
                .returning();
            if (node.type === "folder") {
                await updateFolderDescendantPaths(tx, projectId, oldPath, newPath);
            }
            movedNodes.push(updated!);
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

    if (moved.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.organized",
            title: `${moved.length} file${moved.length === 1 ? "" : "s"} moved`,
            body: "Project files were reorganized.",
            aggregateCount: moved.length,
            sourceEventId: `bulk-move:${newParentId ?? "root"}:${moved.map((node) => node.id).join(",")}`,
            entityRefs: { projectId },
        });
    }

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
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true, name: true, path: true, type: true, metadata: true, s3Key: true, deletedAt: true }
        });
        if (!node) throw new Error("File not found");
        if (node.deletedAt) return;

        await assertSubtreeNotLockedByAnotherUser(tx, projectId, node, user.id);

        const isSystemFolder =
            !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot delete system folder");

        const now = new Date();
        const affectedRows = await tx.update(projectNodes)
            .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
            .where(activeSubtreeWhere(projectId, node))
            .returning({ id: projectNodes.id });
        const affectedIds = affectedRows.map((row) => row.id);

        if (affectedIds.length > 0) {
            await tx.delete(projectFileIndex).where(inArray(projectFileIndex.nodeId, affectedIds));
            await tx.delete(projectNodeLocks).where(inArray(projectNodeLocks.nodeId, affectedIds));
        }
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'trash', {});
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.deleted_restored",
        title: "File moved to trash",
        body: "A project file or folder was moved to trash.",
        sourceEventId: `${nodeId}:trash`,
        entityRefs: { projectId, fileId: nodeId },
    });
    revalidatePath(`/projects/${projectId}`);
}

export async function restoreNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true, parentId: true, name: true, deletedAt: true },
        });
        if (!node) throw new Error("File not found");
        if (!node.deletedAt) return;

        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);
        if (node.parentId) {
            const parent = await tx.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, node.parentId),
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt)
                ),
                columns: { id: true, type: true },
            });
            if (!parent || parent.type !== "folder") {
                throw new Error("Restore the parent folder before restoring this file");
            }
        }
        await assertUniqueSiblingName(projectId, node.parentId ?? null, node.name, tx, node.id);
        await tx.update(projectNodes)
            .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'restore', {});
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.deleted_restored",
        title: "File restored",
        body: "A project file or folder was restored.",
        sourceEventId: `${nodeId}:restore`,
        entityRefs: { projectId, fileId: nodeId },
    });
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
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const nodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, name: true, path: true, type: true, metadata: true, deletedAt: true },
        });
        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }

        for (const node of nodes) {
            await assertSubtreeNotLockedByAnotherUser(tx, projectId, node, user.id);
            const isSystemFolder =
                !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
            if (isSystemFolder) throw new Error(`Cannot delete system folder: ${node.name}`);
        }

        const toTrashNodes = nodes.filter((n) => !n.deletedAt);
        const toTrashIds = toTrashNodes.map((n) => n.id);
        const alreadyTrashedIds = nodes.filter((n) => !!n.deletedAt).map((n) => n.id);

        if (toTrashIds.length > 0) {
            const selectedFolders = toTrashNodes.filter((node) => node.type === "folder");
            const topLevelTrashNodes = toTrashNodes.filter((node) =>
                !selectedFolders.some((folder) =>
                    folder.id !== node.id && node.path.startsWith(`${folder.path}/`)
                )
            );
            const subtreePredicates = topLevelTrashNodes.map((node) => subtreePathPredicate(node));

            const affectedRows = await tx.update(projectNodes)
                .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
                .where(and(
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt),
                    or(...subtreePredicates) ?? sql`FALSE`
                ))
                .returning({ id: projectNodes.id });
            const affectedIds = affectedRows.map((row) => row.id);

            if (affectedIds.length > 0) {
                await tx.delete(projectFileIndex).where(inArray(projectFileIndex.nodeId, affectedIds));
                await tx.delete(projectNodeLocks).where(inArray(projectNodeLocks.nodeId, affectedIds));
            }

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

            return { trashedIds: affectedIds, selectedTrashedIds: toTrashIds, alreadyTrashedIds };
        }

        return { trashedIds: toTrashIds, selectedTrashedIds: toTrashIds, alreadyTrashedIds };
    });

    if (result.trashedIds.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.deleted_restored",
            title: `${result.trashedIds.length} file${result.trashedIds.length === 1 ? "" : "s"} moved to trash`,
            body: "Project files were moved to trash.",
            aggregateCount: result.trashedIds.length,
            sourceEventId: `bulk-trash:${result.selectedTrashedIds.slice(0, 50).join(",")}:${result.trashedIds.length}`,
            entityRefs: { projectId },
        });
    }

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
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const nodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, parentId: true, name: true, deletedAt: true },
        });
        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }

        for (const node of nodes) {
            await assertNodeNotLockedByAnotherUser(projectId, node.id, user.id, tx);
        }

        const toRestoreIds = nodes.filter((n) => !!n.deletedAt).map((n) => n.id);
        const alreadyActiveIds = nodes.filter((n) => !n.deletedAt).map((n) => n.id);
        const toRestoreSet = new Set(toRestoreIds);

        if (toRestoreIds.length > 0) {
            const siblingNameKeys = new Set<string>();
            for (const node of nodes.filter((n) => !!n.deletedAt)) {
                const parentKey = node.parentId ?? "root";
                const siblingKey = `${parentKey}:${node.name.toLowerCase()}`;
                if (siblingNameKeys.has(siblingKey)) {
                    throw new Error(`Duplicate name conflict in restore selection: ${node.name}`);
                }
                siblingNameKeys.add(siblingKey);
                await assertUniqueSiblingName(projectId, node.parentId ?? null, node.name, tx, node.id);
            }

            const parentIdsToCheck = Array.from(new Set(
                nodes
                    .filter((node) => !!node.deletedAt && node.parentId && !toRestoreSet.has(node.parentId))
                    .map((node) => node.parentId as string)
            ));
            if (parentIdsToCheck.length > 0) {
                const activeParents = await tx.query.projectNodes.findMany({
                    where: and(
                        eq(projectNodes.projectId, projectId),
                        inArray(projectNodes.id, parentIdsToCheck),
                        isNull(projectNodes.deletedAt)
                    ),
                    columns: { id: true, type: true },
                });
                const activeFolderParentIds = new Set(activeParents.filter((parent) => parent.type === "folder").map((parent) => parent.id));
                const missingParentId = parentIdsToCheck.find((parentId) => !activeFolderParentIds.has(parentId));
                if (missingParentId) {
                    throw new Error("Restore the parent folder before restoring this file");
                }
            }

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

    if (result.restoredIds.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.deleted_restored",
            title: `${result.restoredIds.length} file${result.restoredIds.length === 1 ? "" : "s"} restored`,
            body: "Project files were restored from trash.",
            aggregateCount: result.restoredIds.length,
            sourceEventId: `bulk-restore:${result.restoredIds.join(",")}`,
            entityRefs: { projectId },
        });
    }

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

    const result = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);

        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { metadata: true, s3Key: true, deletedAt: true }
        });
        const isSystemFolder =
            !!node?.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot delete system folder");
        if (!node?.deletedAt) throw new Error("Node must be in Trash before purging");

        await tx.delete(projectNodes).where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));
        return { s3Key: node.s3Key || null };
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'purge', {});
    revalidatePath(`/projects/${projectId}`);
    return result;
}

export async function deleteNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
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

    const result = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
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
                const safeName = normalizeNodeName(name!);
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
                        pathToId.set(newFolderPaths[i + j]!, inserted[j]!.id);
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
                        path: normalizedFiles[i + j]!.path,
                        fileId: inserted[j]!.id,
                        s3Key: inserted[j]!.s3Key!,
                        name: inserted[j]!.name
                    });
                }
            }
        }

        return resultMappings;
    });
    if (result.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: result.length === 1 ? "files.uploaded" : "files.bulk_uploaded",
            title: result.length === 1 ? `File uploaded: ${result[0]?.name ?? "File"}` : `${result.length} files uploaded`,
            body: result.length === 1
                ? "A file was added to the project workspace."
                : "Multiple files were added to the project workspace.",
            sourceEventId: `bulk:${Date.now()}`,
            aggregateCount: result.length,
            entityRefs: { projectId, fileId: result[0]?.fileId ?? null },
        });
    }
    return result;
}
