"use server";

import { db } from "@/lib/db";
import { projectNodes, projects, tasks } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, isNull, ilike, inArray, sql, asc, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { canProjectMemberUploadFiles } from "@/lib/projects/settings-policies";
import {
    assertProjectFileReadAccess,
    canReadProjectTaskFiles,
    assertTaskFileNodeVisible,
    ensureSystemRootFolder,
} from "@/lib/files/internal-helpers";
import {
    normalizeSearchQuery,
    escapeLikePattern,
    FILES_ERROR_CODES,
    MAX_TREE_PAGE_SIZE,
    MAX_BATCH_PARENT_FOLDERS,
    UUID_RE,
    MAX_BATCH_FETCH_PER_PARENT,
    MAX_BATCH_FETCH_TOTAL,
    BATCH_PARENT_QUERY_CONCURRENCY,
    type FilesActionResult,
} from "./_constants";
import { getTaskLinkCounts } from "./links";
import {
    TASK_WORKING_FILES_TITLE,
} from "@/lib/files/task-working-files";
import {
    getFileAttributionByNodeId,
    type FileAttribution,
} from "@/lib/files/file-attribution";

export type GetProjectNodesResult = {
    nodes: ProjectNodeWithAttribution[];
    nextCursor: string | null;
};

export type ProjectNodeWithAttribution = ProjectNode & FileAttribution;

type BreadcrumbRow = {
    id: string;
    name: string;
    parentId: string | null;
    path?: string | null;
    displayName?: string;
};

/**
 * Translate the private task-folder UUID only at presentation boundaries.
 * The physical node name remains unchanged in storage and traversal code.
 */
async function labelTaskWorkingFilesBreadcrumbs(
    projectId: string,
    rows: BreadcrumbRow[],
): Promise<BreadcrumbRow[]> {
    const taskIds = Array.from(new Set(rows.flatMap((row) => {
        if (!/^\/\.system\/tasks\/[^/]+$/.test(row.path ?? "")) return [];
        return UUID_RE.test(row.name) ? [row.name] : [];
    })));
    if (taskIds.length === 0) {
        return rows.map((row) => row.path === "/.system/tasks"
            ? { ...row, displayName: TASK_WORKING_FILES_TITLE }
            : row);
    }

    const taskRows = await db.query.tasks.findMany({
        where: and(
            eq(tasks.projectId, projectId),
            inArray(tasks.id, taskIds),
            isNull(tasks.deletedAt),
        ),
        columns: { id: true, title: true },
    });
    const titleById = new Map(taskRows.map((task) => [task.id, task.title.trim()]));
    return rows.map((row) => {
        if (row.path === "/.system/tasks") {
            return { ...row, displayName: TASK_WORKING_FILES_TITLE };
        }
        const title = titleById.get(row.name);
        return title ? { ...row, displayName: title } : row;
    });
}

async function enrichNodesWithLatestVersionAttribution(
    nodes: ProjectNode[],
): Promise<ProjectNodeWithAttribution[]> {
    const taskFolderIds = Array.from(new Set(nodes.flatMap((node) => {
        const taskPathMatch = node.path.match(/^\/\.system\/tasks\/([^/]+)(?:\/|$)/);
        if (!taskPathMatch || !UUID_RE.test(taskPathMatch[1] ?? "")) return [];
        return [taskPathMatch[1]!];
    })));
    const projectIds = Array.from(new Set(nodes.map((node) => node.projectId)));
    const attributionByNodeId = await getFileAttributionByNodeId(nodes);

    const taskTitlesById = new Map<string, string>();
    if (taskFolderIds.length > 0) {
        const taskRows = await db.query.tasks.findMany({
            where: and(
                inArray(tasks.id, taskFolderIds),
                inArray(tasks.projectId, projectIds),
                isNull(tasks.deletedAt),
            ),
            columns: { id: true, title: true },
        });
        for (const task of taskRows) {
            const title = task.title.trim();
            if (title) taskTitlesById.set(task.id, title);
        }
    }

    return nodes.map((node) => {
        const taskPathMatch = node.path.match(/^\/\.system\/tasks\/([^/]+)(?:\/|$)/);
        const taskIdFromPath = taskPathMatch?.[1] ?? null;
        const taskTitle = taskIdFromPath ? taskTitlesById.get(taskIdFromPath) : undefined;
        const presentationMetadata = node.path === "/.system/tasks"
            ? {
                ...(node.metadata ?? {}),
                isSystem: true,
                isTaskWorkingFilesCollection: true,
                taskWorkingFilesDisplayName: "Working Files and Reference for this Task",
            }
            : node.type === "folder" && taskTitle
                ? {
                    ...(node.metadata ?? {}),
                    isSystem: true,
                    isTaskWorkingFilesFolder: true,
                    taskWorkingFilesDisplayName: taskTitle,
                }
                : taskTitle
                    ? {
                        ...(node.metadata ?? {}),
                        isTaskWorkingFilesFile: true,
                        taskWorkingFilesTaskTitle: taskTitle,
                    }
                : node.metadata;

        if (node.type !== "file") {
            return presentationMetadata === node.metadata
                ? node
                : { ...node, metadata: presentationMetadata };
        }
        return {
            ...node,
            metadata: presentationMetadata,
            ...(attributionByNodeId.get(node.id) ?? {}),
        };
    });
}

export async function getProjectNodes(
    projectId: string,
    parentId: string | null = null,
    query?: string,
    limit: number = 100,
    cursor?: string, // versioned cursor for the selected server-side sort
    options?: { taskId?: string | null; sort?: "name" | "updated" | "type" },
): Promise<GetProjectNodesResult> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!projectId) {
        console.error("getProjectNodes called with undefined projectId");
        return { nodes: [], nextCursor: null };
    }

    const readAccess = await assertProjectFileReadAccess(projectId, user?.id ?? null);

    const sort = options?.sort ?? "name";
    if (!["name", "updated", "type"].includes(sort)) throw new Error("Invalid file sort");
    const rank = sql<number>`CASE WHEN ${projectNodes.type} = 'folder' THEN 0 ELSE 1 END`;
    const nameKey = sql<string>`lower(${projectNodes.name}) COLLATE "C"`;
    const typeKey = sql<string>`coalesce(${projectNodes.mimeType}, '') COLLATE "C"`;
    const dateKey = sql`date_trunc('milliseconds', ${projectNodes.updatedAt})`;
    const order = sort === "updated" ? [asc(rank), desc(dateKey), asc(nameKey), asc(projectNodes.id)]
      : sort === "type" ? [asc(rank), asc(typeKey), asc(nameKey), asc(projectNodes.id)] : [asc(rank), asc(nameKey), asc(projectNodes.id)];
    const cursorCondition = (() => {
        if (!cursor) return undefined;
        try {
            const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
            if (value.v !== 2 || value.sort !== sort || !UUID_RE.test(value.id) || ![0, 1].includes(value.rank) || typeof value.name !== "string" || value.name.length > 1000) throw new Error();
            const sameRank = sql`${rank} = ${value.rank}`;
            const afterName = sql`(${nameKey}, ${projectNodes.id}) > (lower(${value.name}::text) COLLATE "C", ${value.id}::uuid)`;
            if (sort === "updated") {
                if (typeof value.date !== "string" || !Number.isFinite(Date.parse(value.date))) throw new Error();
                return sql`(${rank} > ${value.rank} OR (${sameRank} AND (${dateKey} < ${value.date}::timestamptz OR (${dateKey} = ${value.date}::timestamptz AND ${afterName}))))`;
            }
            if (sort === "type") {
                if (typeof value.mime !== "string" || value.mime.length > 1000) throw new Error();
                return sql`(${rank} > ${value.rank} OR (${sameRank} AND (${typeKey} > ${value.mime} COLLATE "C" OR (${typeKey} = ${value.mime} COLLATE "C" AND ${afterName}))))`;
            }
            return sql`(${rank} > ${value.rank} OR (${sameRank} AND ${afterName}))`;
        } catch { throw new Error("Invalid project nodes cursor; reopen the folder to restart the listing"); }
    })();
    const pageLimit = Math.min(Math.max(1, limit), MAX_TREE_PAGE_SIZE);
    const normalizedQuery = normalizeSearchQuery(query);
    // ponytail: an exact parent id already scopes directory reads. Allow the
    // managed task subtree there, while flat search/root reads stay public.
    const scopeCondition = !canReadProjectTaskFiles(readAccess)
        ? sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`
        : options?.taskId
        ? sql`(${projectNodes.taskId} IS NULL OR ${projectNodes.taskId} = ${options.taskId})`
        : normalizedQuery || parentId
            ? sql`true`
        : sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`;
    const finishPage = async (nodes: ProjectNodeWithAttribution[]) => {
        let nextCursor: string | null = null;
        if (nodes.length > pageLimit) {
            nodes.pop();
            const last = nodes[nodes.length - 1];
            if (last) nextCursor = Buffer.from(JSON.stringify({ v: 2, sort, id: last.id, rank: last.type === "folder" ? 0 : 1, name: last.name, mime: last.mimeType ?? "", date: last.updatedAt.toISOString() })).toString("base64url");
        }
        return { nodes: await enrichNodesWithLatestVersionAttribution(nodes), nextCursor };
    };

    // --- Search Mode (Flat) ---
    if (normalizedQuery) {
        if (normalizedQuery.length < 2) return { nodes: [], nextCursor: null };
        const whereClause = and(
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
            scopeCondition,
            ilike(projectNodes.name, `%${escapeLikePattern(normalizedQuery)}%`),
            ...(cursorCondition ? [cursorCondition] : []),
        );

        const nodes = await db.query.projectNodes.findMany({
            where: whereClause,
            orderBy: order,
            limit: pageLimit + 1,
        });
        return await finishPage(nodes);
    }

    // --- Directory Listing Mode (Cursor Paginated) ---
    const whereConditions = [
        eq(projectNodes.projectId, projectId),
        isNull(projectNodes.deletedAt),
        scopeCondition,
        parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId)
    ];

    if (cursorCondition) whereConditions.push(cursorCondition);

    // Fetch one extra to check if there is a next page
    const nodes = await db.query.projectNodes.findMany({
        where: and(...whereConditions),
        orderBy: order,
        limit: pageLimit + 1,
    });
    return await finishPage(nodes);
}

/**
 * Explicit, idempotent workspace provisioning command.
 * Reads remain side-effect free; callers invoke this only when an editable,
 * scratch-style project needs its initial system root.
 */
export async function initializeProjectWorkspaceRoot(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const access = await assertProjectFileReadAccess(projectId, user.id);
    const importType = access.project.importSource?.type;
    const isScratchLike = !importType || importType === "scratch";
    const isReady = access.project.syncStatus === "ready";
    const canCreateWorkspaceRoot =
        access.project.ownerId === user.id
        || ("member" in access && !!access.member && canProjectMemberUploadFiles({
            role: access.member.role,
            fileUploadEnabled: access.member.fileUploadEnabled,
        }));

    if (!canCreateWorkspaceRoot || !isScratchLike || !isReady) return null;

    const [project] = await db
        .select({ title: projects.title })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    return ensureSystemRootFolder(projectId, user.id, project?.title || "Project");
}

export async function getProjectNodesSafe(
    projectId: string,
    parentId: string | null = null,
    query?: string,
    limit: number = 100,
    cursor?: string
): Promise<FilesActionResult<GetProjectNodesResult>> {
    try {
        const data = await getProjectNodes(projectId, parentId, query, limit, cursor);
        return { success: true, data };
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : "Failed to load nodes",
        };
    }
}

export async function getProjectBatchNodes(projectId: string, parentIds: (string | null)[]): Promise<{ nodes: ProjectNodeWithAttribution[], taskLinkCounts: Record<string, number> } | []> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!parentIds.length) return [];

    // De-dupe and sanitize. Ignore empty/invalid values so they never hit UUID SQL params.
    const uniqueParents = Array.from(new Set(parentIds));
    const cleanParents = Array.from(
        new Set(
            uniqueParents.flatMap((parentId) => {
                if (parentId === null || parentId === "root") return [null];
                const normalized = String(parentId).trim();
                if (!normalized) return [];
                if (normalized === "root") return [null];
                if (!UUID_RE.test(normalized)) return [];
                return [normalized];
            })
        )
    );

    if (cleanParents.length > MAX_BATCH_PARENT_FOLDERS) {
        throw new Error(`Too many folders requested in one batch. Max: ${MAX_BATCH_PARENT_FOLDERS}`);
    }
    if (!cleanParents.length) return [];
    const actorId = user?.id ?? null;
    const parentKey = cleanParents.map((parentId) => parentId ?? "__root__").sort().join(",");

    return await runInFlightDeduped(`files:batch-nodes:${projectId}:${parentKey}:${actorId ?? "anon"}`, async () => {
        await assertProjectFileReadAccess(projectId, actorId);

        // Fetch per parent to avoid starvation from a single global LIMIT when many folders are expanded.
        const fetchByParent = async (parentId: string | null) => {
            return await db.query.projectNodes.findMany({
                where: and(
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt),
                    sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`,
                    parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId)
                ),
                orderBy: (nodes, { asc }) => [asc(nodes.type), asc(nodes.name), asc(nodes.id)],
                limit: MAX_BATCH_FETCH_PER_PARENT,
            });
        };

        const out: ProjectNode[] = [];
        for (let i = 0; i < cleanParents.length; i += BATCH_PARENT_QUERY_CONCURRENCY) {
            const chunk = cleanParents.slice(i, i + BATCH_PARENT_QUERY_CONCURRENCY);
            const rowsByParent = await Promise.all(chunk.map((parentId) => fetchByParent(parentId)));
            for (const rows of rowsByParent) {
                for (const row of rows) {
                    out.push(row);
                    if (out.length >= MAX_BATCH_FETCH_TOTAL) {
                        logger.metric("files.batch_fetch.cap_hit", {
                            module: "files",
                            projectId,
                            requestedParents: cleanParents.length,
                            fetchedRows: out.length,
                            cap: MAX_BATCH_FETCH_TOTAL,
                        });
                        const enriched = await enrichNodesWithLatestVersionAttribution(out);
                        const fileIds = enriched.filter((node) => node.type === "file").map((node) => node.id);
                        const taskLinkCounts = fileIds.length ? await getTaskLinkCounts(projectId, fileIds) : {};
                        return { nodes: enriched, taskLinkCounts };
                    }
                }
            }
        }

        const enriched = await enrichNodesWithLatestVersionAttribution(out);
        const fileIds = enriched.filter((node) => node.type === "file").map((node) => node.id);
        const taskLinkCounts = fileIds.length ? await getTaskLinkCounts(projectId, fileIds) : {};
        return { nodes: enriched, taskLinkCounts };
    });
}

export async function getNodesByIds(projectId: string, nodeIds: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const unique = Array.from(new Set(nodeIds)).filter(Boolean);
    if (unique.length === 0) return [];
    const actorId = user?.id ?? null;
    const idsKey = unique.slice().sort().join(",");

    return await runInFlightDeduped(`files:nodes-by-ids:${projectId}:${idsKey}:${actorId ?? "anon"}`, async () => {
        const access = await assertProjectFileReadAccess(projectId, actorId);
        const nodes = await db.query.projectNodes.findMany({
            where: and(
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.deletedAt),
                canReadProjectTaskFiles(access) ? sql`true` : sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`,
                inArray(projectNodes.id, unique),
            ),
        });
        return await enrichNodesWithLatestVersionAttribution(nodes);
    });
}

export async function getTaskWorkingFilesCollection(
    projectId: string,
): Promise<FilesActionResult<{
    collection: ProjectNodeWithAttribution | null;
    nodes: ProjectNodeWithAttribution[];
    folderPayloads: Array<{
        parentId: string;
        childIds: string[];
        nextCursor: string | null;
        hasMore: boolean;
        loaded: boolean;
    }>;
    taskLinkCounts: Record<string, number>;
}>> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;

        return await runInFlightDeduped(
            `files:task-working-files:${projectId}:${actorId ?? "anon"}`,
            async () => {
                const access = await assertProjectFileReadAccess(projectId, actorId);
                if (!canReadProjectTaskFiles(access)) throw new Error("Task files are not available to this viewer.");

                const collection = await db.query.projectNodes.findFirst({
                    where: and(
                        eq(projectNodes.projectId, projectId),
                        eq(projectNodes.path, "/.system/tasks"),
                        eq(projectNodes.type, "folder"),
                        isNull(projectNodes.deletedAt),
                    ),
                });
                if (!collection) {
                    return {
                        success: true as const,
                        data: {
                            collection: null,
                            nodes: [],
                            folderPayloads: [],
                            taskLinkCounts: {},
                        },
                    };
                }

                const taskFolders = await db.query.projectNodes.findMany({
                    where: and(
                        eq(projectNodes.projectId, projectId),
                        eq(projectNodes.parentId, collection.id),
                        eq(projectNodes.type, "folder"),
                        isNull(projectNodes.deletedAt),
                    ),
                    orderBy: (nodes, { asc }) => [asc(nodes.name), asc(nodes.id)],
                });
                const taskFolderIds = taskFolders.map((folder) => folder.id);
                const taskFiles = taskFolderIds.length === 0
                    ? []
                    : await db.query.projectNodes.findMany({
                        where: and(
                            eq(projectNodes.projectId, projectId),
                            inArray(projectNodes.parentId, taskFolderIds),
                            isNull(projectNodes.deletedAt),
                        ),
                        orderBy: (nodes, { asc }) => [
                            asc(nodes.parentId),
                            asc(nodes.type),
                            asc(nodes.name),
                            asc(nodes.id),
                        ],
                    });

                const childIdsByTaskFolder = new Map<string, string[]>();
                for (const node of taskFiles) {
                    if (!node.parentId) continue;
                    const childIds = childIdsByTaskFolder.get(node.parentId) ?? [];
                    childIds.push(node.id);
                    childIdsByTaskFolder.set(node.parentId, childIds);
                }
                const nonEmptyTaskFolders = taskFolders.filter(
                    (folder) => (childIdsByTaskFolder.get(folder.id)?.length ?? 0) > 0,
                );
                const visibleTaskFolderIds = new Set(
                    nonEmptyTaskFolders.map((folder) => folder.id),
                );
                const visibleTaskFiles = taskFiles.filter(
                    (node) => node.parentId && visibleTaskFolderIds.has(node.parentId),
                );
                const enriched = await enrichNodesWithLatestVersionAttribution([
                    collection,
                    ...nonEmptyTaskFolders,
                    ...visibleTaskFiles,
                ]);
                const enrichedCollection = enriched[0] ?? null;
                const nodes = enriched.slice(1);
                const fileIds = visibleTaskFiles
                    .filter((node) => node.type === "file")
                    .map((node) => node.id);
                const taskLinkCounts = fileIds.length
                    ? await getTaskLinkCounts(projectId, fileIds)
                    : {};

                // ponytail: hydrate the collection and every task folder in
                // one store commit so task navigation has no lazy-load gap.
                const folderPayloads = [
                    {
                        parentId: collection.id,
                        childIds: nonEmptyTaskFolders.map((folder) => folder.id),
                        nextCursor: null,
                        hasMore: false,
                        loaded: true,
                    },
                    ...nonEmptyTaskFolders.map((folder) => ({
                        parentId: folder.id,
                        childIds: childIdsByTaskFolder.get(folder.id) ?? [],
                        nextCursor: null,
                        hasMore: false,
                        loaded: true,
                    })),
                ];

                return {
                    success: true as const,
                    data: {
                        collection: enrichedCollection,
                        nodes,
                        folderPayloads,
                        taskLinkCounts,
                    },
                };
            },
        );
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error
                ? error.message
                : "Failed to load task files",
        };
    }
}

export async function getNodeMetadataBatch(
    projectId: string,
    nodeIds: string[],
    options?: { includeBreadcrumbs?: boolean }
): Promise<FilesActionResult<{ nodes: ProjectNodeWithAttribution[]; breadcrumbsByNodeId?: Record<string, Array<{ id: string; name: string }>> }>> {
    try {
        const nodes = await getNodesByIds(projectId, nodeIds);
        if (!options?.includeBreadcrumbs) {
            return { success: true, data: { nodes } };
        }

        const nodeById = new Map<string, { id: string; name: string; parentId: string | null }>();
        const ancestorPaths = new Set<string>();
        for (const node of nodes) {
            nodeById.set(node.id, { id: node.id, name: node.name, parentId: node.parentId });
            const parts = node.path.split("/").filter(Boolean);
            let currentPath = "";
            for (const part of parts.slice(0, -1)) {
                currentPath += `/${part}`;
                ancestorPaths.add(currentPath);
            }
        }

        if (ancestorPaths.size > 0) {
            const parents = await db.query.projectNodes.findMany({
                where: and(
                    eq(projectNodes.projectId, projectId),
                    inArray(projectNodes.path, Array.from(ancestorPaths)),
                ),
                columns: { id: true, name: true, parentId: true },
            });
            for (const parent of parents) {
                nodeById.set(parent.id, parent);
            }
        }

        const enrichedNodes = await enrichNodesWithLatestVersionAttribution(nodes);
        const breadcrumbsByNodeId: Record<string, Array<{ id: string; name: string }>> = {};
        for (const node of nodes) {
            const crumbs: Array<{ id: string; name: string }> = [{ id: node.id, name: node.name }];
            let cursor = node.parentId;
            while (cursor) {
                const parent = nodeById.get(cursor);
                if (!parent) break;
                crumbs.unshift({ id: parent.id, name: parent.name });
                cursor = parent.parentId;
            }
            breadcrumbsByNodeId[node.id] = crumbs;
        }

        return { success: true, data: { nodes: enrichedNodes, breadcrumbsByNodeId } };
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : "Failed to load node metadata",
        };
    }
}

export async function getBreadcrumbs(projectId: string, folderId: string | null) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;

    if (!folderId) return [];

    return await runInFlightDeduped(`files:breadcrumbs:${projectId}:${folderId}:${actorId ?? "anon"}`, async () => {
        const access = await assertProjectFileReadAccess(projectId, actorId);
        const folder = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, folderId), eq(projectNodes.projectId, projectId)),
            columns: { path: true, taskId: true, deletedAt: true }
        });
        if (folder) assertTaskFileNodeVisible(access, folder);

        // Materialized Path O(1) query
        if (folder && folder.path && folder.path !== '/') {
            const parts = folder.path.split('/').filter(Boolean);
            const pathsToFetch: string[] = [];
            let cur = "";
            for (const p of parts) {
                cur += "/" + p;
                pathsToFetch.push(cur);
            }

            if (pathsToFetch.length > 0) {
                const rows = await db.query.projectNodes.findMany({
                    where: and(
                        eq(projectNodes.projectId, projectId),
                        // Intentionally inclusive of deleted_at so breadcrumbs resolve
                        // correctly for visible nodes inside deleted folders
                        inArray(projectNodes.path, pathsToFetch)
                    ),
                    columns: { id: true, name: true, parentId: true, path: true }
                });

                // Sort by path length to ensure root-to-leaf order
                rows.sort((a, b) => (a.path?.length || 0) - (b.path?.length || 0));

                return await labelTaskWorkingFilesBreadcrumbs(projectId, rows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    parentId: r.parentId,
                    path: r.path,
                })));
            }
        }

        // Fallback for unmigrated legacy rows
        const rows = await db.execute<{ id: string; name: string; parent_id: string | null; path: string | null }>(sql`
            WITH RECURSIVE ancestors AS (
                SELECT id, name, parent_id, path
                FROM project_nodes
                WHERE id = ${folderId} AND project_id = ${projectId}
                UNION ALL
                SELECT pn.id, pn.name, pn.parent_id, pn.path
                FROM project_nodes pn
                INNER JOIN ancestors a ON pn.id = a.parent_id
                WHERE pn.project_id = ${projectId}
            )
            SELECT id, name, parent_id, path FROM ancestors
        `);

        const arr = Array.from(rows).map((r) => ({
            id: r.id,
            name: r.name,
            parentId: r.parent_id,
            path: r.path,
        }));

        return await labelTaskWorkingFilesBreadcrumbs(projectId, arr.reverse());
    });
}

export async function findNodeByPath(projectId: string, path: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertProjectFileReadAccess(projectId, user?.id ?? null);

    if (!path.length || path[0] === ".system" || path.some((segment) => !segment || segment.includes("/"))) {
        return null;
    }
    return (await db.query.projectNodes.findFirst({
        where: and(
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.path, `/${path.join("/")}`),
            eq(projectNodes.type, "folder"),
            isNull(projectNodes.deletedAt),
            canReadProjectTaskFiles(access) ? sql`true` : isNull(projectNodes.taskId),
        ),
    })) ?? null;
}

export async function findNodeByPathAny(projectId: string, path: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertProjectFileReadAccess(projectId, user?.id ?? null);

    if (!path.length) return null;
    if (!canReadProjectTaskFiles(access) && (path[0] === TASK_WORKING_FILES_TITLE || path[0] === ".system")) return null;

    // Task working files have a readable, public presentation path. The
    // physical `.system/tasks/<uuid>` hierarchy never reaches the URL.
    if (path[0] === TASK_WORKING_FILES_TITLE) {
        if (path.length !== 3 || !path[1]?.trim() || !path[2]?.trim()) return null;
        const matchingTasks = await db.query.tasks.findMany({
            where: and(
                eq(tasks.projectId, projectId),
                eq(tasks.title, path[1]!),
                isNull(tasks.deletedAt),
            ),
            columns: { id: true },
        });
        if (matchingTasks.length !== 1) return null;

        return (await db.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.path, `/.system/tasks/${matchingTasks[0]!.id}/${path[2]}`),
                eq(projectNodes.type, "file"),
                isNull(projectNodes.deletedAt),
            ),
        })) ?? null;
    }

    // Backward compatibility for task-file links created before the public
    // `fileId` URL contract. Resolve only an exact *file* below a verified
    // task folder; never expose or traverse the private `.system` tree.
    // The Files tab immediately canonicalises a successful lookup to
    // `?fileId=<opaque-id>`, removing this storage path from the browser.
    if (path[0] === ".system") {
        if (
            path.length < 4 ||
            path[1] !== "tasks" ||
            !UUID_RE.test(path[2] ?? "")
        ) {
            return null;
        }

        const task = await db.query.tasks.findFirst({
            where: and(
                eq(tasks.id, path[2]!),
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
            ),
            columns: { id: true },
        });
        if (!task) return null;

        return (await db.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.path, `/${path.join("/")}`),
                eq(projectNodes.type, "file"),
                isNull(projectNodes.deletedAt),
            ),
        })) ?? null;
    }

    if (path.some((segment) => !segment || segment.includes("/"))) return null;
    return (await db.query.projectNodes.findFirst({
        where: and(
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.path, `/${path.join("/")}`),
            isNull(projectNodes.deletedAt),
            canReadProjectTaskFiles(access) ? sql`true` : isNull(projectNodes.taskId),
        ),
    })) ?? null;
}

export async function getProjectNodesWithCounts(
    projectId: string,
    parentId: string | null = null,
    query?: string,
    limit: number = 100,
    cursor?: string
): Promise<FilesActionResult<{ nodes: ProjectNodeWithAttribution[]; nextCursor: string | null; taskLinkCounts: Record<string, number> }>> {
    try {
        const result = await getProjectNodes(projectId, parentId, query, limit, cursor);
        const fileIds = result.nodes.filter((node) => node.type === "file").map((node) => node.id);
        const taskLinkCounts = fileIds.length ? await getTaskLinkCounts(projectId, fileIds) : {};
        return {
            success: true,
            data: {
                nodes: result.nodes,
                nextCursor: result.nextCursor,
                taskLinkCounts,
            },
        };
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : "Failed to load folder payload",
        };
    }
}

export async function getProjectRecentNodes(projectId: string, limit: number = 5): Promise<ProjectNodeWithAttribution[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const safeLimit = Math.max(1, Math.min(50, limit));
    return await runInFlightDeduped(`files:recent-nodes:${projectId}:${safeLimit}:${user.id}`, async () => {
        const access = await assertProjectFileReadAccess(projectId, user.id);

        // Fetch the most recently updated files (excluding folders)
        const nodes = await db.query.projectNodes.findMany({
            where: and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.type, 'file'),
                isNull(projectNodes.deletedAt),
                canReadProjectTaskFiles(access) ? sql`true` : sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`,
            ),
            orderBy: (nodes, { desc }) => [desc(nodes.updatedAt)],
            limit: safeLimit,
        });

        return await enrichNodesWithLatestVersionAttribution(nodes);
    });
}
