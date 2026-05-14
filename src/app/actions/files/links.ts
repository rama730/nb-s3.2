"use server";

import { db } from "@/lib/db";
import { profiles, projectNodes, tasks, taskNodeLinks } from "@/lib/db/schema";
import { eq, and, isNull, inArray, sql, desc, ilike } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { notifyTaskParticipantsForFileEvent } from "@/lib/notifications/task-file";
import {
    assertProjectReadAccess,
    assertProjectWriteAccess,
    getTaskProjectId,
} from "./_shared";

export async function getTaskLinkCounts(projectId: string, nodeIds: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

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

export interface LinkedTask {
    taskId: string;
    title: string;
    status: string;
    priority: string;
    assigneeId: string | null;
    assigneeName: string | null;
    annotation: string | null;
    linkedAt: string;
}

export async function getTaskLinksForNode(projectId: string, nodeId: string): Promise<LinkedTask[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    // Confirm the node belongs to the project
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true },
    });
    if (!node) throw new Error("File not found");

    const rows = await db
        .select({
            taskId: tasks.id,
            title: tasks.title,
            status: tasks.status,
            priority: tasks.priority,
            assigneeId: tasks.assigneeId,
            assigneeName: profiles.fullName,
            annotation: taskNodeLinks.annotation,
            linkedAt: taskNodeLinks.linkedAt,
        })
        .from(taskNodeLinks)
        .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
        .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
        .where(and(eq(taskNodeLinks.nodeId, nodeId), isNull(tasks.deletedAt)))
        .orderBy(desc(taskNodeLinks.linkedAt));

    return rows.map((r) => ({
        taskId: r.taskId,
        title: r.title,
        status: r.status,
        priority: r.priority,
        assigneeId: r.assigneeId,
        assigneeName: r.assigneeName,
        annotation: r.annotation,
        linkedAt: r.linkedAt.toISOString(),
    }));
}

export async function linkNodeToTask(
    taskId: string,
    nodeId: string,
    options?: { notificationKind?: "task_file_replaced" | "task_file_needs_review" },
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

    // Ensure node belongs to same project and is not deleted
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)),
        columns: { id: true }
    });
    if (!node) throw new Error("File not found");

    const inserted = await db.insert(taskNodeLinks).values({
        taskId,
        nodeId,
        createdBy: user.id
    }).onConflictDoNothing({
        target: [taskNodeLinks.taskId, taskNodeLinks.nodeId],
    }).returning();

    if (inserted[0]) {
        if (options?.notificationKind) {
            await notifyTaskParticipantsForFileEvent({
                actorUserId: user.id,
                projectId,
                nodeId,
                kind: options.notificationKind,
            });
        }
        return inserted[0];
    }

    const existing = await db.query.taskNodeLinks.findFirst({
        where: and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)),
    });
    if (!existing) throw new Error("Failed to link file to task");
    return existing;
}

export async function unlinkNodeFromTask(taskId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

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
    await assertProjectReadAccess(projectId, user.id);

    const rows = await db
        .select({
            node: projectNodes,
            linkedAt: taskNodeLinks.linkedAt,
            order: taskNodeLinks.order,
            annotation: taskNodeLinks.annotation,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)))
        .orderBy(taskNodeLinks.order, desc(taskNodeLinks.linkedAt));

    return rows.map((r) => ({
        ...r.node,
        linkedAt: r.linkedAt,
        order: r.order,
        annotation: r.annotation,
    }));
}

export async function updateTaskNodeLink(taskId: string, nodeId: string, updates: { order?: number, annotation?: string | null }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

    // Ensure node belongs to same project and is not deleted
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)),
        columns: { id: true }
    });
    if (!node) throw new Error("File not found");

    if (Object.keys(updates).length === 0) return;

    const previous = typeof updates.annotation === "string"
        ? await db.query.taskNodeLinks.findFirst({
            where: and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)),
            columns: { annotation: true },
        })
        : null;

    const updated = await db.update(taskNodeLinks)
        .set(updates)
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)))
        .returning({ annotation: taskNodeLinks.annotation });

    if (updated.length === 0) return;

    const nextAnnotation = typeof updates.annotation === "string" ? updates.annotation.toLowerCase() : "";
    const previousAnnotation = previous?.annotation?.toLowerCase() ?? "";
    if (nextAnnotation.includes("review") && !previousAnnotation.includes("review")) {
        await notifyTaskParticipantsForFileEvent({
            actorUserId: user.id,
            projectId,
            nodeId,
            kind: "task_file_needs_review",
        });
    }
}

export async function updateTaskNodeLinksOrder(taskId: string, updates: { nodeId: string, order: number }[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

    if (!updates || updates.length === 0) return;

    // Secure the node ids to ensure they exist and belong to the project
    const nodeIds = updates.map(u => u.nodeId);
    const nodes = await db.query.projectNodes.findMany({
        where: and(inArray(projectNodes.id, nodeIds), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)),
        columns: { id: true }
    });

    const validNodeIds = new Set(nodes.map(n => n.id));
    const validUpdates = updates.filter(u => validNodeIds.has(u.nodeId));

    if (validUpdates.length === 0) return;

    // Execute updates atomically within a transaction
    await db.transaction(async (tx) => {
        for (const u of validUpdates) {
            await tx.update(taskNodeLinks)
                .set({ order: u.order })
                .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, u.nodeId)));
        }
    });
}

export async function countTaskAttachments(taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectReadAccess(projectId, user.id);

    const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)));

    return Number(rows[0]?.count ?? 0);
}


export interface SearchableTask {
    id: string;
    title: string;
    status: string;
    priority: string;
    taskNumber: number | null;
    projectKey: string | null;
    assigneeName: string | null;
}

export async function searchProjectTasks(
    projectId: string,
    query: string,
    limit: number = 30,
): Promise<SearchableTask[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const trimmed = (query || "").trim();

    // When query is empty, return recent tasks ordered by updatedAt
    if (!trimmed) {
        const rows = await db
            .select({
                id: tasks.id,
                title: tasks.title,
                status: tasks.status,
                priority: tasks.priority,
                taskNumber: tasks.taskNumber,
                assigneeName: profiles.fullName,
            })
            .from(tasks)
            .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
            .orderBy(desc(tasks.updatedAt))
            .limit(safeLimit);

        // Fetch project key separately
        const project = await db.query.projects.findFirst({
            where: (p, { eq: pEq }) => pEq(p.id, projectId),
            columns: { key: true },
        });

        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            priority: r.priority,
            taskNumber: r.taskNumber,
            projectKey: project?.key ?? null,
            assigneeName: r.assigneeName,
        }));
    }

    // Search by title using ilike for fuzzy matching
    const escapedQuery = trimmed.replace(/[%_\\]/g, "\\$&");
    const rows = await db
        .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            priority: tasks.priority,
            taskNumber: tasks.taskNumber,
            assigneeName: profiles.fullName,
        })
        .from(tasks)
        .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
        .where(and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            ilike(tasks.title, `%${escapedQuery}%`),
        ))
        .orderBy(desc(tasks.updatedAt))
        .limit(safeLimit);

    // Fetch project key separately
    const project = await db.query.projects.findFirst({
        where: (p, { eq: pEq }) => pEq(p.id, projectId),
        columns: { key: true },
    });

    return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        taskNumber: r.taskNumber,
        projectKey: project?.key ?? null,
        assigneeName: r.assigneeName,
    }));
}
