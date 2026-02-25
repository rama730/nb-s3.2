"use server";

import { db } from "@/lib/db";
import { projectNodes, taskNodeLinks } from "@/lib/db/schema";
import { eq, and, isNull, inArray, sql, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
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

export async function linkNodeToTask(taskId: string, nodeId: string) {
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

    if (inserted[0]) return inserted[0];

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
    await assertProjectReadAccess(projectId, user.id);

    const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)));

    return Number(rows[0]?.count ?? 0);
}
