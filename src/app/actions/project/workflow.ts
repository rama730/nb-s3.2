"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { projectWorkflowColumns, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { TASK_STATUS_PRESENTATION, TASK_WORKFLOW_STATUSES } from "@/lib/projects/task-workflow";

type WorkflowStatus = (typeof TASK_WORKFLOW_STATUSES)[number];

const columnSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(TASK_WORKFLOW_STATUSES),
    title: z.string().trim().min(1).max(120),
    accentClassName: z.string().trim().min(1).max(160),
    emptyTitle: z.string().trim().min(1).max(160),
    emptyDescription: z.string().trim().min(1).max(320),
    position: z.number().int().min(0).max(5),
    isDefault: z.boolean(),
});

const workflowSchema = z.array(columnSchema).min(4).max(6).superRefine((columns, context) => {
    const ids = new Set(columns.map((column) => column.id));
    if (ids.size !== columns.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Column IDs must be unique" });
    for (const status of TASK_WORKFLOW_STATUSES) {
        if (!columns.some((column) => column.isDefault && column.status === status)) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing default ${status} column` });
        }
    }
});

const createColumnSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    status: z.enum(TASK_WORKFLOW_STATUSES).default("in_progress"),
    accentClassName: z.string().optional(),
});

function defaultColumns(projectId: string) {
    return TASK_WORKFLOW_STATUSES.map((status, position) => ({
        projectId,
        status,
        title: TASK_STATUS_PRESENTATION[status].columnTitle,
        accentClassName: TASK_STATUS_PRESENTATION[status].accentClassName,
        emptyTitle: TASK_STATUS_PRESENTATION[status].emptyTitle,
        emptyDescription: TASK_STATUS_PRESENTATION[status].emptyDescription,
        position,
        isDefault: true,
    }));
}

async function requireWorkflowLeader(projectId: string) {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`project:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) throw new Error("Not found");
    if (!access.isOwner && access.memberRole !== "admin") throw new Error("Only leaders can modify workflow");
    return user;
}

async function ensureWorkflowColumns(projectId: string) {
    await db.insert(projectWorkflowColumns).values(defaultColumns(projectId)).onConflictDoNothing();
    return db.query.projectWorkflowColumns.findMany({
        where: eq(projectWorkflowColumns.projectId, projectId),
        orderBy: [asc(projectWorkflowColumns.position), asc(projectWorkflowColumns.id)],
    });
}

export async function getProjectWorkflowColumnsAction(projectId: string) {
    try {
        const parsed = z.string().uuid().safeParse(projectId);
        if (!parsed.success) return { success: false as const, error: "Invalid project" };
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const access = await getProjectAccessById(parsed.data, user?.id ?? null);
        if (!access.canRead) return { success: false as const, error: "Not found" };
        return { success: true as const, columns: await ensureWorkflowColumns(parsed.data) };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to load workflow" };
    }
}

export async function updateProjectWorkflowColumnsAction(projectId: string, workflow: unknown) {
    try {
        const parsedProjectId = z.string().uuid().safeParse(projectId);
        const parsedWorkflow = workflowSchema.safeParse(workflow);
        if (!parsedProjectId.success || !parsedWorkflow.success) return { success: false as const, error: "Invalid task board configuration" };
        await requireWorkflowLeader(parsedProjectId.data);
        const existing = await ensureWorkflowColumns(parsedProjectId.data);
        if (existing.length !== parsedWorkflow.data.length || !parsedWorkflow.data.every((column) => existing.some((row) => row.id === column.id))) {
            return { success: false as const, error: "Workflow changed elsewhere. Reload and try again." };
        }
        await db.transaction(async (tx) => {
            // Move through a temporary range so a swap never violates the unique project/position index.
            for (const [index, column] of parsedWorkflow.data.entries()) {
                await tx.update(projectWorkflowColumns).set({ position: 100 + index }).where(eq(projectWorkflowColumns.id, column.id));
            }
            for (const column of parsedWorkflow.data) {
                await tx.update(projectWorkflowColumns).set({
                    title: column.title,
                    accentClassName: column.accentClassName,
                    emptyTitle: column.emptyTitle,
                    emptyDescription: column.emptyDescription,
                    position: column.position,
                    updatedAt: new Date(),
                }).where(and(eq(projectWorkflowColumns.id, column.id), eq(projectWorkflowColumns.projectId, parsedProjectId.data)));
            }
        });
        revalidatePath(`/projects/${projectId}`);
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to save workflow" };
    }
}

export async function createProjectWorkflowColumnAction(input: unknown) {
    try {
        const parsed = createColumnSchema.safeParse(input);
        if (!parsed.success) return { success: false as const, error: "Invalid workflow column" };
        await requireWorkflowLeader(parsed.data.projectId);
        const columns = await ensureWorkflowColumns(parsed.data.projectId);
        if (columns.length >= 6) return { success: false as const, error: "A task board supports up to six sections" };
        const status = parsed.data.status as WorkflowStatus;
        const presentation = TASK_STATUS_PRESENTATION[status];
        const [column] = await db.insert(projectWorkflowColumns).values({
            projectId: parsed.data.projectId,
            status,
            title: parsed.data.title,
            accentClassName: parsed.data.accentClassName || presentation.accentClassName,
            emptyTitle: "No tasks here",
            emptyDescription: "Drag tasks into this section",
            position: (columns.at(-1)?.position ?? -1) + 1,
            isDefault: false,
        }).returning();
        return { success: true as const, column };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to add section" };
    }
}

export async function deleteProjectWorkflowColumnAction(projectId: string, columnId: string) {
    try {
        if (!z.string().uuid().safeParse(projectId).success || !z.string().uuid().safeParse(columnId).success) return { success: false as const, error: "Invalid workflow column" };
        await requireWorkflowLeader(projectId);
        const column = await db.query.projectWorkflowColumns.findFirst({ where: and(eq(projectWorkflowColumns.id, columnId), eq(projectWorkflowColumns.projectId, projectId)) });
        if (!column) return { success: false as const, error: "Section not found" };
        if (column.isDefault) return { success: false as const, error: "Default sections cannot be removed" };
        const [taskCount] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.workflowColumnId, columnId));
        if ((taskCount?.count ?? 0) > 0) return { success: false as const, error: "Move tasks out of this section before deleting it" };
        await db.delete(projectWorkflowColumns).where(eq(projectWorkflowColumns.id, columnId));
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to delete section" };
    }
}
