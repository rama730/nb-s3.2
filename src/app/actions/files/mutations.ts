"use server";

import { db } from "@/lib/db";
import { readFileSubtree } from "@/lib/files/permanent-delete";
import { permanentlyDeleteTrashedNode } from "./trash";
import { profiles, projectFileIndex, projectNodeEvents, projectNodeLocks, projectNodes, taskActivityEvents, taskNodeLinks, tasks } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, or, isNull, isNotNull, ilike, inArray, sql, gt, ne, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
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
import { replaceTaskFileRoleTag, type TaskFileRole } from "@/lib/projects/task-file-intelligence";
import {
    assertProjectWriteAccess,
    assertProjectWriteAccessTx,
    assertProjectManageFilesAccess,
    assertProjectManageFilesAccessTx,
    assertProjectFileReadAccess,
    assertProjectUploadAccess,
    assertProjectUploadAccessTx,
    assertValidParentFolder,
    assertValidMoveDestination,
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
    UUID_RE,
} from "./_constants";

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function enqueueFileNotificationBestEffort(input: Parameters<typeof enqueueProjectNotificationEvent>[0]) {
    const run = async () => {
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
    };

    try {
        after(run);
    } catch {
        // If invoked outside a request lifecycle (e.g. scripts/background), run unawaited.
        void run();
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

function taskScopePredicate(taskId: string | null): SQL {
    return sql`${projectNodes.taskId} IS NOT DISTINCT FROM ${taskId}`;
}

function subtreePathPredicate(node: { id: string; path: string; type: string; taskId: string | null }): SQL {
    const predicates: SQL[] = [eq(projectNodes.id, node.id)];
    if (node.type === "folder" && node.path) {
        predicates.push(sql`${projectNodes.path} LIKE ${descendantLikePattern(node.path)} ESCAPE '\\'`);
    }
    return and(taskScopePredicate(node.taskId), or(...predicates) ?? sql`FALSE`) ?? sql`FALSE`;
}

function activeSubtreeWhere(projectId: string, node: { id: string; path: string; type: string; taskId: string | null }): SQL {
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
    taskId: string | null,
) {
    if (!oldPath) return;
    await tx.execute(sql`
        UPDATE project_nodes
        SET path = ${newPath} || SUBSTRING(path FROM ${oldPath.length + 1}),
            updated_at = NOW()
        WHERE project_id = ${projectId}
          AND task_id IS NOT DISTINCT FROM ${taskId}
          AND deleted_at IS NULL
          AND path LIKE ${descendantLikePattern(oldPath)} ESCAPE '\\'
    `);
}

async function assertSubtreeNotLockedByAnotherUser(
    tx: any,
    projectId: string,
    node: { id: string; path: string; type: string; taskId: string | null },
    userId: string,
) {
    const [lock] = await tx
        .select({ nodeId: projectNodeLocks.nodeId })
        .from(projectNodeLocks)
        .innerJoin(projectNodes, eq(projectNodeLocks.nodeId, projectNodes.id))
        .where(and(
            eq(projectNodeLocks.projectId, projectId),
            ne(projectNodeLocks.lockedBy, userId),
            gt(projectNodeLocks.expiresAt, new Date()),
            subtreePathPredicate(node)
        ))
        .limit(1);

    if (lock) {
        throw new Error("A file in this subtree has an active editing lease");
    }
}

export async function createFolder(
    projectId: string,
    parentId: string | null,
    name: string,
    options?: { taskId?: string },
) {
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
            taskId: options?.taskId ?? null,
        }).returning();
        return created!;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_folder', { parentId, name: safeName });
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
    taskId?: string;
    canonicalNodeId?: string;
    taskLink?: { role?: TaskFileRole; annotation?: string | null };
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id);

    const safeName = normalizeNodeName(file.name);
    assertValidNodeName(safeName);
    if (file.taskId && !UUID_RE.test(file.taskId)) throw new Error("Invalid task");
    if (file.taskLink && (!file.taskId || (file.taskLink.role && !["working", "reference", "deliverable"].includes(file.taskLink.role)))) throw new Error("Invalid task link");
    if (file.taskLink?.annotation && file.taskLink.annotation.length > 2000) throw new Error("Task file annotation is too long");
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
        if (file.taskId) {
            const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, file.taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1).for("update");
            if (!task) throw new Error("Task not found");
        }
        if (file.taskLink) await assertProjectWriteAccessTx(tx, projectId, user.id);
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
            taskId: file.taskId || null,
            canonicalNodeId: file.canonicalNodeId || null,
        }).returning();
        if (file.taskLink && file.taskId) {
            const [last] = await tx.select({ order: sql<number>`coalesce(max(${taskNodeLinks.order}), 0)` }).from(taskNodeLinks).where(eq(taskNodeLinks.taskId, file.taskId));
            await tx.insert(taskNodeLinks).values({ taskId: file.taskId, nodeId: created!.id, createdBy: user.id, order: Number(last?.order ?? 0) + 1,
                tags: replaceTaskFileRoleTag([], file.taskLink.role ?? "working"), annotation: file.taskLink.annotation ?? null });
        }
        return created!;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_file', { parentId, name: safeName, s3Key: canonicalS3Key });
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
    const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { fullName: true, username: true, avatarUrl: true },
    });

    // The explorer optimistically upserts this result before its background
    // listing refresh finishes. Include the same attribution shape returned by
    // getProjectNodes so the "By" column never briefly renders as "—".
    return {
        ...node,
        updatedById: user.id,
        updatedByName: profile?.fullName ?? null,
        updatedByUsername: profile?.username ?? null,
        updatedByAvatarUrl: profile?.avatarUrl ?? null,
        versionUpdatedAt: node.updatedAt,
    };
}

export type UploadCollisionSummary = {
    existingFiles: string[];
    existingFolders: string[];
    folderIdsByPath: Record<string, string>;
};

/**
 * Resolve an upload's intended relative paths against the persisted tree.
 * This is deliberately a read-only preflight: clients can explain what will
 * be reused/skipped before bytes are sent, while the create mutations remain
 * the authoritative race-safe uniqueness guard.
 */
export async function getUploadCollisionSummary(
    projectId: string,
    targetParentId: string | null,
    paths: string[],
    options?: { taskId?: string | null },
): Promise<UploadCollisionSummary> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectUploadAccess(projectId, user.id);

    if (paths.length > 5000) {
        throw new Error("Maximum 5000 paths allowed per collision check");
    }

    const normalizedPaths = Array.from(new Set(paths
        .map((path) => normalizeAndValidateUploadRelativePath(path))
        .filter(Boolean)));
    if (normalizedPaths.length === 0) {
        return { existingFiles: [], existingFolders: [], folderIdsByPath: {} };
    }

    const taskId = options?.taskId ?? null;
    const pathInputs = normalizedPaths.map((path) => ({ path, segments: path.split("/") }));
    const segmentCount = pathInputs.reduce((total, input) => total + input.segments.length, 0);
    if (segmentCount > 10_000) {
        throw new Error("Upload paths contain too many nested segments");
    }

    // Walk only the submitted sibling chains. The active sibling uniqueness
    // index owns races; this preflight never scans the rest of the project tree.
    const matchedRows = await db.execute<{
        input_path: string;
        relative_path: string;
        node_id: string;
        node_type: "file" | "folder";
    }>(sql`
        WITH RECURSIVE input_paths AS (
            SELECT input.path, input.segments
            FROM jsonb_to_recordset(${JSON.stringify(pathInputs)}::jsonb)
                AS input(path text, segments text[])
        ), walk AS (
            SELECT
                input.path AS input_path,
                input.segments,
                1 AS depth,
                ${targetParentId}::uuid AS parent_id,
                NULL::uuid AS node_id,
                NULL::text AS node_type
            FROM input_paths input

            UNION ALL

            SELECT
                walk.input_path,
                walk.segments,
                walk.depth + 1,
                node.id,
                node.id,
                node.type
            FROM walk
            JOIN project_nodes node
              ON node.project_id = ${projectId}::uuid
             AND node.parent_id IS NOT DISTINCT FROM walk.parent_id
             AND lower(node.name) = lower(walk.segments[walk.depth])
             AND node.task_id IS NOT DISTINCT FROM ${taskId}::uuid
             AND node.deleted_at IS NULL
            WHERE walk.depth <= cardinality(walk.segments)
              AND (walk.node_type IS NULL OR walk.node_type = 'folder')
        )
        SELECT
            input_path,
            array_to_string(segments[1:depth - 1], '/') AS relative_path,
            node_id,
            node_type
        FROM walk
        WHERE node_id IS NOT NULL
    `);

    const existingFiles = new Set<string>();
    const existingFolders = new Set<string>();
    const folderIdsByPath: Record<string, string> = {};

    for (const row of matchedRows) {
        if (row.node_type === "folder") {
            existingFolders.add(row.relative_path);
            folderIdsByPath[row.relative_path] = row.node_id;
        } else {
            existingFiles.add(row.relative_path);
        }
    }

    return {
        existingFiles: Array.from(existingFiles).sort(),
        existingFolders: Array.from(existingFolders).sort(),
        folderIdsByPath,
    };
}

export async function renameNode(nodeId: string, newName: string, projectId: string, expectedUpdatedAt?: string) {
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
            columns: { id: true, parentId: true, taskId: true, metadata: true, deletedAt: true, path: true, type: true, updatedAt: true },
        });

        if (!current || current.deletedAt) throw new Error("File not found");
        if (expectedUpdatedAt !== undefined && current.updatedAt.toISOString() !== expectedUpdatedAt)
            throw new Error("This item changed since the rename. Review its current name before renaming again.");
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

        await updateFolderDescendantPaths(tx, projectId, oldPath, newPath, current.taskId ?? null);

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
    // ponytail: client explorer handles rename via Zustand renameNodeInCaches; skip route revalidation
    return node;
}

export type MoveProjectNodesResult = {
    nodes: ProjectNode[];
    operationId: string | null;
    affectedParentIds: Array<string | null>;
};

export async function moveProjectNodes(
    nodeIds: string[],
    newParentId: string | null,
    projectId: string,
    options?: {
        expectedParentByNode?: Record<string, string | null>;
        mode?: "move" | "publish";
    },
): Promise<MoveProjectNodesResult> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectManageFilesAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);
    const operationId = randomUUID();

    const result = await db.transaction(async (tx) => {
        await assertProjectManageFilesAccessTx(tx, projectId, user.id);
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
                taskId: true,
                metadata: true,
            },
        });

        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing or already deleted");
        }

        for (const node of nodes) {
            if (
                options?.expectedParentByNode &&
                Object.prototype.hasOwnProperty.call(options.expectedParentByNode, node.id) &&
                (node.parentId ?? null) !== options.expectedParentByNode[node.id]
            ) {
                throw new Error(`Cannot undo move because "${node.name}" changed after the original operation`);
            }
        }

        const movers = nodes.filter((node) => (node.parentId ?? null) !== newParentId);
        if (movers.length === 0) {
            return { nodes: [] as ProjectNode[], operationId: null, affectedParentIds: [] as Array<string | null> };
        }
        const isPublishing = options?.mode === "publish";
        if (!isPublishing && movers.some((node) => node.taskId)) {
            throw new Error("Task working files must be published to Project Files before they can be relocated");
        }
        if (isPublishing && movers.some((node) => !node.taskId)) {
            throw new Error("Only task-owned files or folders can be published with this action");
        }
        await assertValidMoveDestination(projectId, newParentId, null, tx);

        const targetNameSet = new Set<string>();
        for (const node of movers) {
            await assertNodeNotLockedByAnotherUser(projectId, node.id, user.id, tx);
            const isSystemFolder =
                !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
            if (isSystemFolder) throw new Error(`Cannot move system folder: ${node.name}`);
            if (newParentId === node.id) throw new Error("Cannot move node into itself");

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

        const selectedFolders = movers.filter((node) => node.type === "folder");
        for (const node of movers) {
            const selectedAncestor = selectedFolders.find((folder) =>
                folder.id !== node.id && node.path.startsWith(`${folder.path}/`)
            );
            if (selectedAncestor) {
                throw new Error(`Selection contains both "${selectedAncestor.name}" and one of its descendants. Select the top-level folder only.`);
            }
        }

        const movedNodes: ProjectNode[] = [];
        const affectedParentIds = new Set<string | null>([newParentId]);
        const newParentPath = await getParentPath(tx, projectId, newParentId);
        const now = new Date();
        const linkedTasks = await tx
            .select({ nodeId: taskNodeLinks.nodeId, taskId: taskNodeLinks.taskId, sprintId: tasks.sprintId })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(tasks.id, taskNodeLinks.taskId))
            .where(inArray(taskNodeLinks.nodeId, movers.map((node) => node.id)));
        for (const node of movers) {
            const oldPath = node.path;
            const newPath = `${newParentPath}/${node.name}`;
            affectedParentIds.add(node.parentId ?? null);
            const [updated] = await tx.update(projectNodes)
                .set({
                    parentId: newParentId,
                    path: newPath,
                    taskId: isPublishing ? null : node.taskId,
                    updatedAt: now,
            })
            .where(and(eq(projectNodes.id, node.id), eq(projectNodes.projectId, projectId)))
            .returning();
            if (node.type === "folder") {
                if (isPublishing) {
                    await tx.execute(sql`
                        UPDATE project_nodes
                        SET task_id = NULL,
                            updated_at = NOW()
                        WHERE project_id = ${projectId}
                          AND path LIKE ${descendantLikePattern(oldPath)} ESCAPE '\\'
                          AND deleted_at IS NULL
                    `);
                }
                await updateFolderDescendantPaths(tx, projectId, oldPath, newPath, node.taskId ?? null);
            }
            movedNodes.push(updated!);
            await recordNodeEvent(projectId, user.id, node.id, isPublishing ? "publish_task_file" : "move", {
                operationId,
                oldParentId: node.parentId ?? null,
                newParentId,
                oldPath,
                newPath,
                taskId: node.taskId ?? null,
            }, tx);
            const nodeTaskLinks = linkedTasks.filter((link) => link.nodeId === node.id);
            if (nodeTaskLinks.length > 0) {
                await tx.insert(taskActivityEvents).values(
                    nodeTaskLinks.map((link) => ({
                        taskId: link.taskId,
                        projectId,
                        sprintId: link.sprintId,
                        actorId: user.id,
                        eventType: isPublishing ? "file_published" : "file_relocated",
                        payload: { operationId, fileName: node.name, oldPath, newPath },
                        createdAt: now,
                    })),
                );
            }
        }

        return { nodes: movedNodes, operationId, affectedParentIds: Array.from(affectedParentIds) };
    });

    if (result.nodes.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.organized",
            title: options?.mode === "publish"
                ? `${result.nodes.length} task file${result.nodes.length === 1 ? "" : "s"} published`
                : `${result.nodes.length} file${result.nodes.length === 1 ? "" : "s"} moved`,
            body: options?.mode === "publish"
                ? "Task working files were published to Project Files."
                : "Project files were reorganized.",
            aggregateCount: result.nodes.length,
            sourceEventId: operationId,
            entityRefs: { projectId },
        });
        // ponytail: client explorer handles move via Zustand; skip route revalidation
    }
    return result;
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
            columns: { id: true, name: true, path: true, type: true, taskId: true, metadata: true, s3Key: true, deletedAt: true }
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
    // ponytail: client explorer handles deletion via Zustand removeNodeFromCaches; skip route revalidation
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
            columns: { id: true, parentId: true, name: true, deletedAt: true, metadata: true },
        });
        if (!node) throw new Error("File not found");
        if (!node.deletedAt) return;
        if (node.metadata?.permanentDeleteRoot) throw new Error("Permanent deletion is pending. This item cannot be restored.");

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
        const subtree = await readFileSubtree(tx, projectId, nodeId);
        // Restore only this trash operation; items deleted earlier stay in Trash.
        const restoreIds = subtree.filter(item => item.deletedAt?.getTime() === node.deletedAt!.getTime()).map(item => item.id);
        const restoreSet = new Set(restoreIds);
        for (const item of subtree.filter(item => restoreSet.has(item.id))) {
            if (item.metadata?.permanentDeleteRoot) throw new Error("Permanent deletion is pending in this folder.");
            await assertNodeNotLockedByAnotherUser(projectId, item.id, user.id, tx);
            await assertUniqueSiblingName(projectId, item.parentId ?? null, item.name, tx, item.id);
        }
        await tx.update(projectNodes)
            .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
            .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, restoreIds)));
        await recordNodeEvent(projectId, user.id, nodeId, "restore", { restoredIds: restoreIds }, tx);
    });

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
    // ponytail: client handles trash restore via query invalidation; skip route revalidation
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
            columns: { id: true, name: true, path: true, type: true, taskId: true, metadata: true, deletedAt: true },
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

            return { trashedIds: affectedIds, selectedTrashedIds: toTrashIds, alreadyTrashedIds, deletedAt: now.toISOString() };
        }

        return { trashedIds: toTrashIds, selectedTrashedIds: toTrashIds, alreadyTrashedIds, deletedAt: now.toISOString() };
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

    // ponytail: client handles trash purge via query invalidation; skip route revalidation
    return result;
}

export async function bulkRestoreNodes(nodeIds: string[], projectId: string, expectedDeletedAt?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);

    const now = new Date();
    const result = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const selectedNodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, parentId: true, name: true, deletedAt: true, metadata: true },
        });
        if (selectedNodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }
        if (expectedDeletedAt !== undefined && selectedNodes.some(node => node.deletedAt?.toISOString() !== expectedDeletedAt))
            throw new Error("These items changed since they were trashed. Review Trash before restoring them.");

        // Match single-folder restore: include only descendants deleted in
        // the same operation; explicitly selected older deletions still restore.
        const restoreScope = new Map(selectedNodes.map(node => [node.id, node]));
        for (const selected of selectedNodes.filter(node => !!node.deletedAt)) {
            const subtree = await readFileSubtree(tx, projectId, selected.id);
            for (const child of subtree) if (child.deletedAt?.getTime() === selected.deletedAt!.getTime()) restoreScope.set(child.id, child);
            if (restoreScope.size > 500) throw new Error("Restore up to 500 items at a time. Choose smaller folders.");
        }
        const nodes = [...restoreScope.values()];

        for (const node of nodes) {
            if (node.metadata?.permanentDeleteRoot) throw new Error("Permanent deletion is pending. This item cannot be restored.");
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

    // ponytail: client handles trash restore via query invalidation; skip route revalidation
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

/** Paged trash browser; the legacy sidebar getter remains backward compatible. */
export async function getTrashPage(projectId: string, query = "", cursor?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);
    if (cursor && !UUID_RE.test(cursor)) throw new Error("Invalid cursor");
    const rows = await db
        .select({
            node: projectNodes,
            deletedByName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username}, case when ${projectNodes.deletedBy} is not null then 'Former member' else null end)`,
        })
        .from(projectNodes)
        .leftJoin(profiles, eq(profiles.id, projectNodes.deletedBy))
        .where(and(eq(projectNodes.projectId, projectId), isNotNull(projectNodes.deletedAt),
            query.trim() ? ilike(projectNodes.name, `%${escapeLikePattern(query.trim().slice(0, 200))}%`) : undefined,
            cursor ? gt(projectNodes.id, cursor) : undefined))
        .orderBy(projectNodes.id)
        .limit(101);
    const page = rows.slice(0, 100);
    return {
        nodes: page.map(({ node, deletedByName }) => ({ ...node, deletedByName })),
        nextCursor: rows.length > 100 ? page.at(-1)!.node.id : null,
    };
}

/** Legacy export kept safe: deletion now requires Trash and reviewed scope. */
export async function deleteNode(nodeId: string, projectId: string, expectedFingerprint: string) {
    return permanentlyDeleteTrashedNode(projectId, nodeId, expectedFingerprint);
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
            sourceEventId: `bulk:${Date.now()}`,
            aggregateCount: result.length,
            entityRefs: { projectId, fileId: result[0]?.fileId ?? null },
        });
    }
    return result;
}

export async function getOrCreateTaskSystemFolderAction(projectId: string, taskId: string): Promise<string> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectUploadAccess(projectId, user.id);

    return await db.transaction(async (tx) => {
        // Find or create /.system
        let systemRoot = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, '.system'), isNull(projectNodes.parentId)),
            columns: { id: true }
        });
        if (!systemRoot) {
            const [created] = await tx.insert(projectNodes).values({
                projectId,
                parentId: null,
                type: 'folder',
                name: '.system',
                path: '/.system',
                createdBy: user.id,
                metadata: { isSystem: true }
            }).onConflictDoNothing().returning({ id: projectNodes.id });
            systemRoot = created ?? await tx.query.projectNodes.findFirst({
                where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, '.system'), isNull(projectNodes.parentId)),
                columns: { id: true },
            });
        }

        // Find or create /.system/tasks
        let tasksRoot = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, 'tasks'), eq(projectNodes.parentId, systemRoot!.id)),
            columns: { id: true }
        });
        if (!tasksRoot) {
            const [created] = await tx.insert(projectNodes).values({
                projectId,
                parentId: systemRoot!.id,
                type: 'folder',
                name: 'tasks',
                path: '/.system/tasks',
                createdBy: user.id,
                metadata: { isSystem: true }
            }).onConflictDoNothing().returning({ id: projectNodes.id });
            tasksRoot = created ?? await tx.query.projectNodes.findFirst({
                where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, 'tasks'), eq(projectNodes.parentId, systemRoot!.id)),
                columns: { id: true },
            });
        }

        // Find or create /.system/tasks/[taskId]
        let taskFolder = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, taskId), eq(projectNodes.parentId, tasksRoot!.id)),
            columns: { id: true }
        });
        if (!taskFolder) {
            const [created] = await tx.insert(projectNodes).values({
                projectId,
                parentId: tasksRoot!.id,
                type: 'folder',
                name: taskId,
                path: `/.system/tasks/${taskId}`,
                createdBy: user.id,
                metadata: { isSystem: true }
            }).onConflictDoNothing().returning({ id: projectNodes.id });
            taskFolder = created ?? await tx.query.projectNodes.findFirst({
                where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, taskId), eq(projectNodes.parentId, tasksRoot!.id)),
                columns: { id: true },
            });
        }

        return taskFolder!.id;
    });
}

export async function getSystemTasksFolderIdAction(projectId: string): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectFileReadAccess(projectId, user.id);

    const systemRoot = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, '.system'), isNull(projectNodes.parentId)),
        columns: { id: true }
    });
    if (!systemRoot) return null;

    const tasksRoot = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, 'tasks'), eq(projectNodes.parentId, systemRoot.id)),
        columns: { id: true }
    });
    if (!tasksRoot) return null;

    return tasksRoot.id;
}
