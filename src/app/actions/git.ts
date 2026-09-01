"use server";
import { createClient } from "@/lib/supabase/server";
import { resolveSyncContext } from "@/lib/github/sync-service";

/** Compatibility for old clients; unreviewed mutations cannot bypass sync review. */
export async function getProjectGitConnection(projectId: string) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const ctx = await resolveSyncContext(projectId, user.id);
  return {
    repository: ctx.repository,
    branch: ctx.connection?.branch || ctx.project.githubDefaultBranch,
    lastSyncAt: ctx.project.githubLastSyncAt,
  };
}
export async function pushToGitHub(
  _projectId: string,
  _message: string,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  return {
    success: false,
    error:
      "Open Files → GitHub Sync and review the selected changes before publishing.",
  };
}
export async function pullFromGitHub(
  _projectId: string,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  return {
    success: false,
    error:
      "Open Files → GitHub Sync and review incoming changes before applying them.",
  };
}
