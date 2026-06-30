import { NextRequest } from "next/server";
import {
    enforceRouteLimit,
    jsonError,
    jsonSuccess,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { getProjectAccessById } from "@/lib/data/project-access";
import { projectMemberCan } from "@/lib/projects/settings-policies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/projects/[id]/capabilities
 * Fetches the capability policy checklist for the current authenticated user on the project.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const rlResponse = await enforceRouteLimit(
        request,
        "api:v1:projects:capabilities:get",
        60,
        60
    );
    if (rlResponse) return rlResponse;

    const { user, response } = await requireAuthenticatedUser();
    if (response) return response;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const { id: projectId } = await context.params;
    if (!UUID_RE.test(projectId)) {
        return jsonError("Invalid project id", 400, "BAD_REQUEST");
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
        return jsonError("Project not found", 404, "NOT_FOUND");
    }

    if (!access.canRead) {
        return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    // Resolve project role
    let role = "viewer";
    if (access.isOwner) {
        role = "owner";
    } else if (access.isMember) {
        role = access.memberRole || "member";
    }

    const capabilities = {
        canReadFiles: access.canRead,
        canCreateFiles: projectMemberCan(role, "upload_files"),
        canEditFiles: projectMemberCan(role, "upload_files"),
        canAcquireLock: projectMemberCan(role, "upload_files"),
        canStageToTask: projectMemberCan(role, "create_tasks"),
        canMergeTask: projectMemberCan(role, "merge_task"),
        canManageSettings: projectMemberCan(role, "manage_settings"),
    };

    return jsonSuccess(capabilities);
}
