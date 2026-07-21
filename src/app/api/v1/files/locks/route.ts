import { z } from "zod";

import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { getProjectFileLeases } from "@/lib/files/file-lock-service";
import { assertProjectFileReadAccess } from "@/lib/files/internal-helpers";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const limited = await enforceRouteLimit(request, "api:v1:files:locks", 120, 60);
    if (limited) return limited;
    const projectId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("projectId"));
    if (!projectId.success) return jsonError("Invalid project id", 400, "BAD_REQUEST");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectFileReadAccess(projectId.data, user?.id ?? null);
    return jsonSuccess({ locks: await getProjectFileLeases(projectId.data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load file leases";
    if (/unauthorized/i.test(message)) return jsonError(message, 401, "UNAUTHORIZED");
    if (/forbidden/i.test(message)) return jsonError(message, 403, "FORBIDDEN");
    return jsonError(message, 500, "INTERNAL_ERROR");
  }
}
