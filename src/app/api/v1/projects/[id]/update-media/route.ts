import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { enforceRouteLimit, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { isProjectTabVisibleToViewer } from "@/lib/projects/settings-policies";
import { PROJECT_UPDATE_MEDIA_BUCKET } from "@/lib/projects/updates";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const limitResponse = await enforceRouteLimit(request, "api:v1:projects:updateMedia", 180, 60);
    if (limitResponse) return limitResponse;

    const { id: projectId } = await context.params;
    if (!UUID_RE.test(projectId)) return jsonError("Not found", 404, "NOT_FOUND");

    const storageKey = request.nextUrl.searchParams.get("key")?.trim() ?? "";
    const expectedPrefix = `projects/${projectId}/update-media/`;
    if (!storageKey.startsWith(expectedPrefix) || storageKey.includes("..")) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await getProjectAccessById(projectId, user?.id ?? null);
    if (!access.project || !access.canRead) return jsonError("Not found", 404, "NOT_FOUND");

    const [project] = await db
        .select({
            id: projects.id,
            publicTabVisibility: projects.publicTabVisibility,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

    const isOwnerOrMember = access.isOwner || access.isMember;
    const canReadUpdates = Boolean(project && isProjectTabVisibleToViewer({
        tabId: "updates",
        isOwnerOrMember,
        canManageSettings: access.isOwner,
        publicTabVisibility: project.publicTabVisibility,
    }));
    if (!canReadUpdates) return jsonError("Not found", 404, "NOT_FOUND");

    const admin = await createAdminClient();
    const { data, error } = await admin.storage
        .from(PROJECT_UPDATE_MEDIA_BUCKET)
        .createSignedUrl(storageKey, 60);
    if (error || !data?.signedUrl) {
        logger.warn("project_updates.media_route_presign_failed", {
            module: "projects",
            projectId,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            storageKey,
            error: error?.message || "Missing signed URL",
        });
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const response = NextResponse.redirect(data.signedUrl, 302);
    response.headers.set("Cache-Control", isOwnerOrMember || user ? "private, no-store" : "public, max-age=300, s-maxage=300, stale-while-revalidate=86400");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
}
