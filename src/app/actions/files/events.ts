"use server";

import { db } from "@/lib/db";
import { profiles, projectNodeEvents, projectNodes, tasks, taskNodeLinks } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import {
    assertProjectReadAccess,
    assertProjectWriteAccess,
    recordNodeEvent,
} from "./_shared";
import {
    MAX_NODE_ACTIVITY_ITEMS,
    MAX_NODE_LINKED_TASKS,
} from "./_constants";

export async function recordProjectNodeEvent(
    projectId: string,
    nodeId: string,
    type: string,
    metadata: Record<string, unknown> = {},
    options?: { idempotencyKey?: string }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);
    const payload =
        options?.idempotencyKey && !metadata.idempotencyKey
            ? { ...metadata, idempotencyKey: options.idempotencyKey }
            : metadata;
    await recordNodeEvent(projectId, user.id, nodeId, type, payload);
}

export async function getLastNodeEvent(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

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

export type ProjectNodeActivityItem = {
    id: string;
    type: string;
    at: number;
    by: string | null;
    metadata: Record<string, unknown> | null;
};

export async function getNodeActivity(projectId: string, nodeId: string, limit: number = 25) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true },
    });
    if (!node) throw new Error("File not found");

    const safeLimit = Math.min(MAX_NODE_ACTIVITY_ITEMS, Math.max(1, limit));
    const rows = await db
        .select({
            id: projectNodeEvents.id,
            type: projectNodeEvents.type,
            createdAt: projectNodeEvents.createdAt,
            metadata: projectNodeEvents.metadata,
            username: profiles.username,
            fullName: profiles.fullName,
        })
        .from(projectNodeEvents)
        .leftJoin(profiles, eq(projectNodeEvents.actorId, profiles.id))
        .where(and(eq(projectNodeEvents.projectId, projectId), eq(projectNodeEvents.nodeId, nodeId)))
        .orderBy(desc(projectNodeEvents.createdAt))
        .limit(safeLimit);

    return rows.map((row) => ({
        id: row.id,
        type: row.type,
        at: row.createdAt.getTime(),
        by: row.fullName || row.username || null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    })) as ProjectNodeActivityItem[];
}

export type ProjectNodeLinkedTask = {
    id: string;
    title: string;
    status: string;
    priority: string;
    taskNumber: number | null;
    dueDate: number | null;
    linkedAt: number;
};

export async function getNodeLinkedTasks(projectId: string, nodeId: string, limit: number = 25) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true },
    });
    if (!node) throw new Error("File not found");

    const safeLimit = Math.min(MAX_NODE_LINKED_TASKS, Math.max(1, limit));
    const rows = await db
        .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            priority: tasks.priority,
            taskNumber: tasks.taskNumber,
            dueDate: tasks.dueDate,
            linkedAt: taskNodeLinks.linkedAt,
        })
        .from(taskNodeLinks)
        .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
        .where(and(eq(taskNodeLinks.nodeId, nodeId), eq(tasks.projectId, projectId)))
        .orderBy(desc(taskNodeLinks.linkedAt))
        .limit(safeLimit);

    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        taskNumber: row.taskNumber ?? null,
        dueDate: row.dueDate ? row.dueDate.getTime() : null,
        linkedAt: row.linkedAt.getTime(),
    })) as ProjectNodeLinkedTask[];
}
