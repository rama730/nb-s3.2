import { NextRequest, NextResponse } from "next/server";

import { enforceRouteLimit, jsonError } from "@/app/api/v1/_shared";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { isProjectTabVisibleToViewer } from "@/lib/projects/settings-policies";
import { PROJECT_UPDATE_MEDIA_BUCKET } from "@/lib/projects/updates";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 15 * 60;
const PRIVATE_REDIRECT_MAX_AGE_SECONDS = 120;
const PUBLIC_REDIRECT_MAX_AGE_SECONDS = 5 * 60;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const limitResponse = await enforceRouteLimit(request, "api:v1:projects:updateMedia", 180, 60);
    if (limitResponse) return limitResponse;

    const { id: projectId } = await context.params;
    if (!isUuid(projectId)) return jsonError("Not found", 404, "NOT_FOUND");

    const storageKey = request.nextUrl.searchParams.get("key")?.trim() ?? "";
    const expectedPrefix = `projects/${projectId}/update-media/`;
    if (!storageKey.startsWith(expectedPrefix) || storageKey.includes("..")) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await getProjectAccessById(projectId, user?.id ?? null);
    if (!access.project || !access.canRead) return jsonError("Not found", 404, "NOT_FOUND");

    const isOwnerOrMember = access.isOwner || access.isMember;
    const canReadUpdates = isProjectTabVisibleToViewer({
        tabId: "updates",
        isOwnerOrMember,
        canManageSettings: access.isOwner,
        publicTabVisibility: access.project.publicTabVisibility,
    });
    if (!canReadUpdates) return jsonError("Not found", 404, "NOT_FOUND");

    const admin = await createAdminClient();
    const { data, error } = await admin.storage
        .from(PROJECT_UPDATE_MEDIA_BUCKET)
        .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
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
    const isPublicAnonymousRead = !user && !isOwnerOrMember;
    response.headers.set(
        "Cache-Control",
        isPublicAnonymousRead
            ? `public, max-age=${PUBLIC_REDIRECT_MAX_AGE_SECONDS}, s-maxage=${PUBLIC_REDIRECT_MAX_AGE_SECONDS}, stale-while-revalidate=86400`
            : `private, max-age=${PRIVATE_REDIRECT_MAX_AGE_SECONDS}`,
    );
    response.headers.set(
        "CDN-Cache-Control",
        isPublicAnonymousRead
            ? `public, max-age=${PUBLIC_REDIRECT_MAX_AGE_SECONDS}, stale-while-revalidate=86400`
            : "private, no-store",
    );
    response.headers.set("Vary", "Cookie, Authorization");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
}
