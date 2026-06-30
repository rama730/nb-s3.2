import { NextRequest } from "next/server";
import {
    enforceRouteLimit,
    jsonError,
    jsonSuccess,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { getProjectAccessById } from "@/lib/data/project-access";
import { projectMemberCan } from "@/lib/projects/settings-policies";
import { mergeSandboxTask } from "@/lib/projects/merge-sandbox";
import { validateCsrf } from "@/lib/security/csrf";
import { z } from "zod";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mergeBodySchema = z.object({
    sessionId: z.string().uuid(),
    targetBranch: z.string().optional().default("main"),
});

/**
 * POST /api/v1/projects/[id]/tasks/[taskId]/merge
 * Triggers the transactional task sandbox merge.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string; taskId: string }> }
) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const { id: projectId, taskId } = await context.params;

        if (!UUID_RE.test(projectId) || !UUID_RE.test(taskId)) {
            return jsonError("Invalid parameters", 400, "BAD_REQUEST");
        }

        const limitResponse = await enforceRouteLimit(
            request,
            `api:v1:projects:${projectId}:tasks:${taskId}:merge`,
            10,
            60
        );
        if (limitResponse) return limitResponse;

        const { user, response } = await requireAuthenticatedUser();
        if (response) return response;
        if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError("Invalid JSON", 400, "BAD_REQUEST");
        }

        const parsed = mergeBodySchema.safeParse(body);
        if (!parsed.success) {
            return jsonError("Invalid request body", 400, "BAD_REQUEST");
        }

        const { sessionId, targetBranch } = parsed.data;

        // Check project access and role
        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project) {
            return jsonError("Project not found", 404, "NOT_FOUND");
        }

        let role = "viewer";
        if (access.isOwner) {
            role = "owner";
        } else if (access.isMember) {
            role = access.memberRole || "member";
        }

        // Server-side policy validation
        if (!projectMemberCan(role, "merge_task")) {
            return jsonError("Forbidden: You do not have permission to merge tasks", 403, "FORBIDDEN");
        }

        const result = await mergeSandboxTask(user.id, projectId, taskId, sessionId, targetBranch);

        return jsonSuccess({
            merged: true,
            sequenceNumber: result.sequenceNumber,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[api/projects/tasks/merge] merge failed", { error: message });
        if (message.startsWith("ERR_FS_PATH_COLLISION")) {
            return jsonError(message, 409, "CONFLICT");
        }
        return jsonError("Internal error", 500, "INTERNAL_ERROR");
    }
}
