"use server";

import { createClient } from "@/lib/supabase/server";
import { getProjectAccessById } from "@/lib/data/project-access";
import { projectMemberCan } from "@/lib/projects/settings-policies";
import { mergeSandboxTask } from "@/lib/projects/merge-sandbox";
import { revalidatePath } from "next/cache";

export type MergeActionResult = 
  | { success: true; sequenceNumber: number }
  | { success: false; errorCode: string; message: string };

/**
 * Server action to merge a task sandbox branch back into the main branch.
 * Enforces security capability policies on the server side.
 */
export async function mergeTaskAction(
    projectId: string,
    taskId: string,
    sessionId: string,
    targetBranch: string = 'main'
): Promise<MergeActionResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, errorCode: "UNAUTHORIZED", message: "Not authenticated" };
        }

        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project) {
            return { success: false, errorCode: "NOT_FOUND", message: "Project not found" };
        }

        // Resolve user's project role
        let role = "viewer";
        if (access.isOwner) {
            role = "owner";
        } else if (access.isMember) {
            role = access.memberRole || "member";
        }

        // Server-Side Enforcement of can_merge_task capability
        if (!projectMemberCan(role, "merge_task")) {
            return { success: false, errorCode: "FORBIDDEN", message: "You do not have permission to merge tasks in this project" };
        }

        const result = await mergeSandboxTask(user.id, projectId, taskId, sessionId, targetBranch);
        
        revalidatePath(`/projects/${projectId}/files`);
        
        return { success: true, sequenceNumber: result.sequenceNumber };
    } catch (error: any) {
        console.error("[mergeTaskAction] error:", error);
        return { 
            success: false, 
            errorCode: error.message?.startsWith("ERR_FS_") ? "CONFLICT" : "INTERNAL_ERROR", 
            message: error.message || "Failed to merge sandbox task" 
        };
    }
}
