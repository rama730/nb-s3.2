"use server";

import { db } from "@/lib/db";
import { profiles, projectFileIndex, projectMembers, projectNodeEvents, projectNodeLocks, projectNodes, taskNodeLinks, projects, tasks } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, ilike, inArray, sql, desc, type SQL } from "drizzle-orm";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import prettier from "prettier";

async function assertProjectAccess(projectId: string, userId: string) {
    const [project] = await db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId));

    if (!project) throw new Error("Project not found");
    if (project.ownerId === userId) return;

    const member = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .limit(1);

    if (member.length === 0) throw new Error("Forbidden");
}

async function getTaskProjectId(taskId: string): Promise<string> {
    const rows = await db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

    const projectId = rows[0]?.projectId;
    if (!projectId) throw new Error("Task not found");
    return projectId;
}

export async function getProjectNodes(projectId: string, parentId: string | null = null, query?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    if (!projectId) {
        console.error("getProjectNodes called with undefined projectId");
        return [];
    }

    await assertProjectAccess(projectId, user.id);

    let whereClause;
    if (query && query.trim()) {
        // Recursive/Flat search across entire project
        whereClause = and(
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt),
            ilike(projectNodes.name, `%${query.trim()}%`)
        );
    } else {
        // Directory listing
        whereClause = parentId
            ? and(eq(projectNodes.projectId, projectId), eq(projectNodes.parentId, parentId), isNull(projectNodes.deletedAt))
            : and(eq(projectNodes.projectId, projectId), isNull(projectNodes.parentId), isNull(projectNodes.deletedAt));
    }

    let nodes = await db.query.projectNodes.findMany({
        where: whereClause,
        orderBy: (nodes, { asc }) => [asc(nodes.type), asc(nodes.name)],
    });

    // Auto-create default root folder if project is empty at root
    if (!parentId && !query && nodes.length === 0) {
        try {
            // Fetch project title
            const [project] = await db.select({ title: projects.title }).from(projects).where(eq(projects.id, projectId));

            if (project) {
                const [rootNode] = await db.insert(projectNodes).values({
                    projectId,
                    parentId: null,
                    type: 'folder',
                    name: project.title, // Default folder name = Project Title
                    createdBy: user.id,
                    metadata: { isSystem: true } // Mark as system folder
                }).returning();

                nodes = [rootNode];
            }
        } catch (err) {
            console.error("Failed to auto-create root folder", err);
        }
    }

    return nodes;
}

async function recordNodeEvent(projectId: string, actorId: string | null, nodeId: string | null, type: string, metadata: Record<string, unknown> = {}) {
    await db.insert(projectNodeEvents).values({
        projectId,
        actorId,
        nodeId,
        type,
        metadata,
        createdAt: new Date(),
    });
}

export async function recordProjectNodeEvent(projectId: string, nodeId: string, type: string, metadata: Record<string, unknown> = {}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);
    await recordNodeEvent(projectId, user.id, nodeId, type, metadata);
}

export async function getLastNodeEvent(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const rows = await db
        .select({
            type: projectNodeEvents.type,
            createdAt: projectNodeEvents.createdAt,
            username: profiles.username,
            fullName: profiles.fullName,
        })
        .from(projectNodeEvents)
        .leftJoin(profiles, eq(projectNodeEvents.actorId, profiles.id))
        .where(and(eq(projectNodeEvents.projectId, projectId), eq(projectNodeEvents.nodeId, nodeId)))
        .orderBy(desc(projectNodeEvents.createdAt))
        .limit(1);

    const r = rows[0];
    if (!r) return null;
    return {
        type: r.type,
        at: r.createdAt.getTime(),
        by: r.fullName || r.username || null,
    };
}


export async function getTaskLinkCounts(projectId: string, nodeIds: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const unique = Array.from(new Set(nodeIds)).filter(Boolean);
    if (unique.length === 0) return {} as Record<string, number>;

    const rows = await db
        .select({
            nodeId: taskNodeLinks.nodeId,
            count: sql<number>`count(*)`,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(projectNodes.projectId, projectId), inArray(taskNodeLinks.nodeId, unique)))
        .groupBy(taskNodeLinks.nodeId);

    const out: Record<string, number> = {};
    for (const r of rows) out[r.nodeId] = Number(r.count) || 0;
    return out;
}

export async function getNodesByIds(projectId: string, nodeIds: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const unique = Array.from(new Set(nodeIds)).filter(Boolean);
    if (unique.length === 0) return [];

    return await db.query.projectNodes.findMany({
        where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, unique)),
    });
}

export async function formatProjectFileContent(projectId: string, filename: string, content: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const ext = filename.split('.').pop()?.toLowerCase();
    const parser =
        ext === 'ts' || ext === 'tsx' ? 'typescript' :
            ext === 'js' || ext === 'jsx' ? 'babel' :
                ext === 'json' ? 'json' :
                    ext === 'md' ? 'markdown' :
                        ext === 'css' ? 'css' :
                            ext === 'html' ? 'html' :
                                null;

    if (!parser) return content;

    return await prettier.format(content, { parser });
}

export async function upsertProjectFileIndex(projectId: string, nodeId: string, content: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    // only index reasonably-sized text to avoid DB bloat
    const MAX_CHARS = 200_000;
    const safe = (content || "").slice(0, MAX_CHARS);

    // ensure node exists and belongs to project
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true, type: true }
    });
    if (!node) throw new Error("File not found");
    if (node.type !== 'file') throw new Error("Not a file");

    await db
        .insert(projectFileIndex)
        .values({ nodeId, projectId, content: safe, updatedAt: new Date() })
        .onConflictDoUpdate({
            target: projectFileIndex.nodeId,
            set: { content: safe, updatedAt: new Date() },
        });
}

export async function searchProjectFileIndex(projectId: string, query: string, limit: number = 50) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const q = (query || "").trim();
    if (!q) return [] as Array<{ nodeId: string; snippet: string }>;

    const rows = await db
        .select({
            nodeId: projectFileIndex.nodeId,
            snippet: sql<string>`substring(${projectFileIndex.content} from 1 for 240)`,
        })
        .from(projectFileIndex)
        .where(and(eq(projectFileIndex.projectId, projectId), ilike(projectFileIndex.content, `%${q}%`)))
        .limit(Math.min(200, Math.max(1, limit)));

    return rows.map(r => ({ nodeId: r.nodeId, snippet: r.snippet }));
}

export async function acquireProjectNodeLock(projectId: string, nodeId: string, ttlSeconds: number = 120) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    return await db.transaction(async (tx) => {
        // Ensure node belongs to project
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true }
        });
        if (!node) throw new Error("File not found");

        const existing = await tx.query.projectNodeLocks.findFirst({
            where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
        });

        if (existing && existing.expiresAt > now && existing.lockedBy !== user.id) {
            const lockUser = await tx.query.profiles.findFirst({
                where: eq(profiles.id, existing.lockedBy),
                columns: { id: true, username: true, fullName: true }
            });
            return {
                ok: false as const,
                lock: {
                    nodeId,
                    projectId,
                    lockedBy: existing.lockedBy,
                    lockedByName: lockUser?.fullName || lockUser?.username || null,
                    expiresAt: existing.expiresAt.getTime(),
                }
            };
        }

        if (existing) {
            await tx.update(projectNodeLocks)
                .set({ lockedBy: user.id, acquiredAt: now, expiresAt })
                .where(and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)));
        } else {
            await tx.insert(projectNodeLocks).values({
                nodeId,
                projectId,
                lockedBy: user.id,
                acquiredAt: now,
                expiresAt,
            });
        }

        await tx.insert(projectNodeEvents).values({
            projectId,
            nodeId,
            actorId: user.id,
            type: 'lock_acquire',
            metadata: { expiresAt: expiresAt.toISOString() },
            createdAt: now,
        });

        return {
            ok: true as const,
            lock: {
                nodeId,
                projectId,
                lockedBy: user.id,
                lockedByName: null,
                expiresAt: expiresAt.getTime(),
            }
        };
    });
}

export async function refreshProjectNodeLock(projectId: string, nodeId: string, ttlSeconds: number = 120) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const existing = await db.query.projectNodeLocks.findFirst({
        where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
    });

    if (!existing) return { ok: false as const, reason: "missing" as const };
    if (existing.lockedBy !== user.id) return { ok: false as const, reason: "not_owner" as const };

    await db.update(projectNodeLocks)
        .set({ expiresAt })
        .where(and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)));

    return { ok: true as const, expiresAt: expiresAt.getTime() };
}

export async function releaseProjectNodeLock(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    await db.delete(projectNodeLocks).where(
        and(
            eq(projectNodeLocks.projectId, projectId),
            eq(projectNodeLocks.nodeId, nodeId),
            eq(projectNodeLocks.lockedBy, user.id)
        )
    );

    await recordNodeEvent(projectId, user.id, nodeId, 'lock_release', {});
}

export async function createFolder(projectId: string, parentId: string | null, name: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const [node] = await db.insert(projectNodes).values({
        projectId,
        parentId,
        type: 'folder',
        name,
        createdBy: user.id,
    }).returning();

    await recordNodeEvent(projectId, user.id, node.id, 'create_folder', { parentId, name });
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
    await assertProjectAccess(projectId, user.id);

    const [node] = await db.insert(projectNodes).values({
        projectId,
        parentId,
        type: 'file',
        name: file.name,
        s3Key: file.s3Key,
        size: file.size, // schema uses bigint({ mode: 'number' }) so we pass number
        mimeType: file.mimeType,
        createdBy: user.id,
    }).returning();

    await recordNodeEvent(projectId, user.id, node.id, 'create_file', { parentId, name: file.name, s3Key: file.s3Key });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function renameNode(nodeId: string, newName: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const [node] = await db.update(projectNodes)
        .set({ name: newName, updatedAt: new Date() })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
        .returning();

    await recordNodeEvent(projectId, user.id, nodeId, 'rename', { newName });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function trashNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    // Check if system node
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { metadata: true, s3Key: true, deletedAt: true }
    });

    const isSystemFolder =
        !!node?.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
    if (isSystemFolder) {
        throw new Error("Cannot delete system folder");
    }

    if (node?.deletedAt) return; // already trashed

    await db.update(projectNodes)
        .set({ deletedAt: new Date(), deletedBy: user.id, updatedAt: new Date() })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));

    // best-effort: remove index and lock rows
    await db.delete(projectFileIndex).where(eq(projectFileIndex.nodeId, nodeId));
    await db.delete(projectNodeLocks).where(eq(projectNodeLocks.nodeId, nodeId));

    await recordNodeEvent(projectId, user.id, nodeId, 'trash', {});
    revalidatePath(`/projects/${projectId}`);
}

export async function restoreNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    await db.update(projectNodes)
        .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));

    await recordNodeEvent(projectId, user.id, nodeId, 'restore', {});
    revalidatePath(`/projects/${projectId}`);
}

export async function getTrashNodes(projectId: string, query?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const q = query?.trim();
    const whereClause = q
        ? and(eq(projectNodes.projectId, projectId), ilike(projectNodes.name, `%${q}%`), isNotNull(projectNodes.deletedAt))
        : and(eq(projectNodes.projectId, projectId), isNotNull(projectNodes.deletedAt));

    return await db.query.projectNodes.findMany({
        where: whereClause,
        orderBy: (nodes, { desc }) => [desc(nodes.deletedAt)],
    });
}

export async function purgeNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

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

// Backward-compatible hard delete (permanent). Prefer trashNode + purgeNode.
export async function deleteNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { metadata: true }
    });
    const isSystemFolder =
        !!node?.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
    if (isSystemFolder) throw new Error("Cannot delete system folder");

    await db.delete(projectFileIndex).where(eq(projectFileIndex.nodeId, nodeId));
    await db.delete(projectNodeLocks).where(eq(projectNodeLocks.nodeId, nodeId));
    await recordNodeEvent(projectId, user.id, nodeId, 'delete', {});
    await db.delete(projectNodes).where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)));
    revalidatePath(`/projects/${projectId}`);
}

export async function moveNode(nodeId: string, newParentId: string | null, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    const [node] = await db.update(projectNodes)
        .set({ parentId: newParentId, updatedAt: new Date() })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
        .returning();

    await recordNodeEvent(projectId, user.id, nodeId, 'move', { newParentId });
    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function getBreadcrumbs(projectId: string, folderId: string | null) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectAccess(projectId, user.id);

    // Simple recursive fetch or just building iteratively if depth is small.
    // For now we might not strictly need this server action if we manage state on client, 
    // but it's good for deep linking.
    // Implementing a simple iterative fetch up the tree:
    if (!folderId) return [];

    const crumbs = [];
    let currentId = folderId;

    // Safety limit of 10 levels to prevent infinite loops if data is corrupted
    for (let i = 0; i < 10; i++) {
        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, currentId), eq(projectNodes.projectId, projectId)),
            columns: { id: true, name: true, parentId: true }
        });
        if (!node) break;
        crumbs.unshift(node);
        if (!node.parentId) break;
        currentId = node.parentId;
    }
    return crumbs;
}

export async function linkNodeToTask(taskId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectAccess(projectId, user.id);

    // Ensure node belongs to same project and is not deleted
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)),
        columns: { id: true }
    });
    if (!node) throw new Error("File not found");

    // Check if already linked (idempotent)
    const existing = await db.query.taskNodeLinks.findFirst({
        where: and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)),
    });
    if (existing) return existing;

    const [link] = await db.insert(taskNodeLinks).values({
        taskId,
        nodeId,
        createdBy: user.id
    }).returning();

    return link;
}

export async function unlinkNodeFromTask(taskId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectAccess(projectId, user.id);

    // Ensure node belongs to the same project (prevents unlinking arbitrary links across projects)
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true }
    });
    if (!node) throw new Error("File not found");

    await db.delete(taskNodeLinks).where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)));
}

export async function getTaskAttachments(taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectAccess(projectId, user.id);

    const rows = await db
        .select({
            node: projectNodes,
            linkedAt: taskNodeLinks.linkedAt,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)))
        .orderBy(desc(taskNodeLinks.linkedAt));

    return rows.map((r) => r.node);
}

export async function countTaskAttachments(taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectAccess(projectId, user.id);

    const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)));

    return Number(rows[0]?.count ?? 0);
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

function isWithParent(parentId: string | null) {
    return parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId);
}
