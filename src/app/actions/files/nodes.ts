"use server";

import { db } from "@/lib/db";
import { projectNodes, projects } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, isNull, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
    assertProjectReadAccess,
    assertProjectAccess,
    ensureSystemRootFolder,
} from "./_shared";
import {
    normalizeSearchQuery,
    escapeLikePattern,
    isWithParent,
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

export type GetProjectNodesResult = {
    nodes: ProjectNode[];
    nextCursor: string | null;
};

export async function getProjectNodes(
    projectId: string,
    parentId: string | null = null,
    query?: string,
    limit: number = 100,
    cursor?: string // we'll use base64 encoded "{type}:{name}:{id}" as cursor for stable sort
): Promise<GetProjectNodesResult | ProjectNode[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!projectId) {
        console.error("getProjectNodes called with undefined projectId");
        if (query !== undefined) return []; // backward compat return type
        return { nodes: [], nextCursor: null };
    }

    const access = await assertProjectReadAccess(projectId, user?.id ?? null);

    // --- Search Mode (Flat) ---
    const normalizedQuery = normalizeSearchQuery(query);
    if (normalizedQuery) {
        if (normalizedQuery.length < 2) return [];
        const whereClause = and(
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
            ilike(projectNodes.name, `%${escapeLikePattern(normalizedQuery)}%`)
        );

        const nodes = await db.query.projectNodes.findMany({
            where: whereClause,
            orderBy: (nodes, { asc }) => [asc(nodes.type), asc(nodes.name)],
            limit: 100 // Hard limit for search for now
        });
        return nodes; // Return plain array for search (backward compat for now)
    }

    // --- Directory Listing Mode (Cursor Paginated) ---
    const whereConditions = [
        eq(projectNodes.projectId, projectId),
        isNull(projectNodes.deletedAt),
        parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId)
    ];

    // Cursor decoding
    if (cursor) {
        try {
            const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
            const [cType, cName, cId] = decoded.split(':::'); // use ::: separator
            if (cType && cName && cId) {
                // We want: (type > cType) OR (type = cType AND name > cName) OR (type = cType AND name = cName AND id > cId)
                // Drizzle DSL:
                whereConditions.push(
                    sql`(${projectNodes.type} > ${cType} OR 
                        (${projectNodes.type} = ${cType} AND ${projectNodes.name} > ${cName}) OR
                        (${projectNodes.type} = ${cType} AND ${projectNodes.name} = ${cName} AND ${projectNodes.id} > ${cId}))`
                );
            }
        } catch {
            // ignore invalid cursor
        }
    }

    const LIMIT = Math.min(Math.max(1, limit), MAX_TREE_PAGE_SIZE);

    // Fetch one extra to check if there is a next page
    const nodes = await db.query.projectNodes.findMany({
        where: and(...whereConditions),
        orderBy: (nodes, { asc }) => [asc(nodes.type), asc(nodes.name), asc(nodes.id)],
        limit: LIMIT + 1,
    });

    let nextCursor: string | null = null;
    if (nodes.length > LIMIT) {
        nodes.pop(); // remove the extra one
        const lastItem = nodes[nodes.length - 1]; // the actual last valid item
        if (lastItem) {
            nextCursor = Buffer.from(`${lastItem.type}:::${lastItem.name}:::${lastItem.id}`).toString('base64');
        }
    }

    // Auto-create default root folder if project is empty at root
    // IMPORTANT: Do NOT create system roots for imported projects (GitHub/Upload),
    // otherwise you end up with a confusing extra folder beside the imported tree.
    const importType = access.project.importSource?.type;
    const isScratchLike = !importType || importType === 'scratch';
    const isReady = access.project.syncStatus === 'ready';

    if (access.canWrite && !!user && !parentId && nodes.length === 0 && !cursor && isScratchLike && isReady) {
        try {
            // Race-safe: only one request per project can create/read the system root in this transaction.
            const [project] = await db
                .select({ title: projects.title })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);
            const rootNode = await ensureSystemRootFolder(projectId, user.id, project?.title || "Project");
            return { nodes: [rootNode], nextCursor: null };
        } catch (err) {
            console.error("Failed to auto-create root folder", err);
        }
    }

    return { nodes, nextCursor };
}

export async function getProjectNodesSafe(
    projectId: string,
    parentId: string | null = null,
    query?: string,
    limit: number = 100,
    cursor?: string
): Promise<FilesActionResult<GetProjectNodesResult | ProjectNode[]>> {
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

export async function getProjectBatchNodes(projectId: string, parentIds: (string | null)[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!parentIds.length) return [];

    await assertProjectReadAccess(projectId, user?.id ?? null);

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

    // Fetch per parent to avoid starvation from a single global LIMIT when many folders are expanded.
    const fetchByParent = async (parentId: string | null) => {
        return await db.query.projectNodes.findMany({
            where: and(
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.deletedAt),
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
                    return out;
                }
            }
        }
    }

    return out;
}

export async function getNodesByIds(projectId: string, nodeIds: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const unique = Array.from(new Set(nodeIds)).filter(Boolean);
    if (unique.length === 0) return [];

    return await db.query.projectNodes.findMany({
        where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, unique)),
    });
}

export async function getNodeMetadataBatch(
    projectId: string,
    nodeIds: string[],
    options?: { includeBreadcrumbs?: boolean }
): Promise<FilesActionResult<{ nodes: ProjectNode[]; breadcrumbsByNodeId?: Record<string, Array<{ id: string; name: string }>> }>> {
    try {
        const nodes = await getNodesByIds(projectId, nodeIds);
        if (!options?.includeBreadcrumbs) {
            return { success: true, data: { nodes } };
        }

        const nodeById = new Map<string, { id: string; name: string; parentId: string | null }>();
        for (const n of nodes) nodeById.set(n.id, { id: n.id, name: n.name, parentId: n.parentId });

        let toFetch = new Set<string>();
        for (const n of nodes) {
            if (n.parentId && !nodeById.has(n.parentId)) toFetch.add(n.parentId);
        }

        for (let depth = 0; depth < 32 && toFetch.size > 0; depth += 1) {
            const ids = Array.from(toFetch);
            const parents = await db.query.projectNodes.findMany({
                where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, ids)),
                columns: { id: true, name: true, parentId: true },
            });
            toFetch = new Set<string>();
            for (const p of parents) {
                nodeById.set(p.id, { id: p.id, name: p.name, parentId: p.parentId });
                if (p.parentId && !nodeById.has(p.parentId)) toFetch.add(p.parentId);
            }
        }

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

        return { success: true, data: { nodes, breadcrumbsByNodeId } };
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
    await assertProjectReadAccess(projectId, user?.id ?? null);

    if (!folderId) return [];

    const rows = await db.execute<{ id: string; name: string; parent_id: string | null }>(sql`
        WITH RECURSIVE ancestors AS (
            SELECT id, name, parent_id
            FROM project_nodes
            WHERE id = ${folderId} AND project_id = ${projectId} AND deleted_at IS NULL
            UNION ALL
            SELECT pn.id, pn.name, pn.parent_id
            FROM project_nodes pn
            INNER JOIN ancestors a ON pn.id = a.parent_id
            WHERE pn.project_id = ${projectId} AND pn.deleted_at IS NULL
        )
        SELECT id, name, parent_id FROM ancestors
    `);

    const arr = Array.from(rows).map((r) => ({
        id: r.id,
        name: r.name,
        parentId: r.parent_id,
    }));

    return arr.reverse();
}

export async function findNodeByPath(projectId: string, path: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    // Helper to find a folder by path names ["Tasks", "Task-123"]
    // This is simple sequential lookup. Optimized version would use recursive CTE.
    let currentParentId: string | null = null;
    let currentNode: ProjectNode | null = null;

    for (const segment of path) {
        currentNode = (await db.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.projectId, projectId),
                isWithParent(currentParentId),
                eq(projectNodes.name, segment),
                eq(projectNodes.type, 'folder')
            )
        })) ?? null;

        if (!currentNode) return null;
        currentParentId = currentNode.id;
    }
    return currentNode;
}

export async function findNodeByPathAny(projectId: string, path: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    if (!path.length) return null;

    let currentParentId: string | null = null;
    let currentNode: ProjectNode | null = null;

    for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const isLast = i === path.length - 1;

        const whereClause: SQL = isLast
            ? and(
                eq(projectNodes.projectId, projectId),
                isWithParent(currentParentId),
                eq(projectNodes.name, segment)
            )!
            : and(
                eq(projectNodes.projectId, projectId),
                isWithParent(currentParentId),
                eq(projectNodes.name, segment),
                eq(projectNodes.type, 'folder')
            )!;

        currentNode = (await db.query.projectNodes.findFirst({
            where: whereClause
        })) ?? null;

        if (!currentNode) return null;
        currentParentId = currentNode.id;
    }

    return currentNode;
}

export async function getProjectNodesWithCounts(
    projectId: string,
    parentId: string | null = null,
    query?: string,
    limit: number = 100,
    cursor?: string
): Promise<FilesActionResult<{ nodes: ProjectNode[]; nextCursor: string | null; taskLinkCounts: Record<string, number> }>> {
    try {
        const result = await getProjectNodes(projectId, parentId, query, limit, cursor);
        const normalized = Array.isArray(result) ? { nodes: result, nextCursor: null } : result;
        const fileIds = normalized.nodes.filter((node) => node.type === "file").map((node) => node.id);
        const taskLinkCounts = fileIds.length ? await getTaskLinkCounts(projectId, fileIds) : {};
        return {
            success: true,
            data: {
                nodes: normalized.nodes,
                nextCursor: normalized.nextCursor,
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
