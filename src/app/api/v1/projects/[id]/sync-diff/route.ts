import { NextRequest } from "next/server";
import {
    enforceRouteLimit,
    jsonError,
    jsonSuccess,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projectNodeEvents, projectNodes, projects, taskNodeLinks, tasks } from "@/lib/db/schema";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { getProjectAccessById } from "@/lib/data/project-access";
import { isLooseUuid } from "@/lib/validations/uuid";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinceSchema = z.coerce.number().int().min(0);

/**
 * GET /api/v1/projects/[id]/sync-diff
 * Returns events that have occurred in a project since a specific sequence version.
 * Query: ?since=123
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const rlResponse = await enforceRouteLimit(
        request,
        "api:v1:projects:sync-diff:get",
        60,
        60
    );
    if (rlResponse) return rlResponse;

    const { user, response } = await requireAuthenticatedUser();
    if (response) return response;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const { id: projectId } = await context.params;
    if (!isLooseUuid(projectId)) {
        return jsonError("Invalid project id", 400, "BAD_REQUEST");
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
        return jsonError("Project not found", 404, "NOT_FOUND");
    }
    if (!access.canRead) {
        return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    const sinceStr = request.nextUrl.searchParams.get("since");
    if (!sinceStr) {
        return jsonError("Missing required since parameter", 400, "BAD_REQUEST");
    }

    const parsedSince = sinceSchema.safeParse(sinceStr);
    if (!parsedSince.success) {
        return jsonError("Invalid since parameter", 400, "BAD_REQUEST");
    }
    const since = parsedSince.data;

    const [projectSequence] = await db
        .select({ currentSequence: projects.currentSequenceNumber })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    const rows = await db
        .select({
            id: projectNodeEvents.id,
            nodeId: projectNodeEvents.nodeId,
            actorId: projectNodeEvents.actorId,
            type: projectNodeEvents.type,
            sequenceNumber: projectNodeEvents.sequenceNumber,
            metadata: projectNodeEvents.metadata,
            createdAt: projectNodeEvents.createdAt,
            node: {
                id: projectNodes.id,
                parentId: projectNodes.parentId,
                name: projectNodes.name,
                type: projectNodes.type,
                path: projectNodes.path,
                size: projectNodes.size,
                mimeType: projectNodes.mimeType,
                currentVersion: projectNodes.currentVersion,
                syncStatus: projectNodes.syncStatus,
                updatedAt: projectNodes.updatedAt,
                deletedAt: projectNodes.deletedAt,
            },
        })
        .from(projectNodeEvents)
        .leftJoin(projectNodes, eq(projectNodeEvents.nodeId, projectNodes.id))
        .where(
            and(
                eq(projectNodeEvents.projectId, projectId),
                gt(projectNodeEvents.sequenceNumber, since)
            )
        )
        .orderBy(projectNodeEvents.sequenceNumber);

    const nodeIds = Array.from(new Set(rows.map((row) => row.nodeId).filter((value): value is string => Boolean(value))));
    const linkedTaskRows = nodeIds.length
        ? await db
            .select({
                nodeId: taskNodeLinks.nodeId,
                taskId: taskNodeLinks.taskId,
                title: tasks.title,
                taskNumber: tasks.taskNumber,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .where(and(inArray(taskNodeLinks.nodeId, nodeIds), isNull(tasks.deletedAt)))
        : [];
    const linkedTasksByNodeId = new Map<string, Array<{ id: string; title: string | null; taskNumber: number | null }>>();
    for (const row of linkedTaskRows) {
        const list = linkedTasksByNodeId.get(row.nodeId) ?? [];
        list.push({ id: row.taskId, title: row.title, taskNumber: row.taskNumber });
        linkedTasksByNodeId.set(row.nodeId, list);
    }

    const events = rows.map((row) => ({
        id: row.id,
        nodeId: row.nodeId,
        actorId: row.actorId,
        type: row.type,
        sequenceNumber: row.sequenceNumber,
        metadata: row.metadata,
        createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
        node: row.node?.id ? {
            ...row.node,
            nodeId: row.node.id,
            linkedTasks: linkedTasksByNodeId.get(row.node.id) ?? [],
            updatedAt: row.node.updatedAt?.toISOString?.() ?? row.node.updatedAt,
            deletedAt: row.node.deletedAt?.toISOString?.() ?? row.node.deletedAt,
        } : null,
    }));

    return jsonSuccess({
        currentSequence: projectSequence?.currentSequence ?? since,
        events,
    });
}
