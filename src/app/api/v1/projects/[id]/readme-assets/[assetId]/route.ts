import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectMembers, projectReadmeAssets, projectReadmes, projects } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { enforceRouteLimit, jsonError } from "@/app/api/v1/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; assetId: string }> },
) {
    const limitResponse = await enforceRouteLimit(request, "api:v1:projects:readmeAssets", 120, 60);
    if (limitResponse) return limitResponse;

    const { id: projectId, assetId } = await context.params;
    if (!UUID_RE.test(projectId) || !UUID_RE.test(assetId)) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const [row] = await db
        .select({
            bucket: projectReadmeAssets.bucket,
            storageKey: projectReadmeAssets.storageKey,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            publicTabVisibility: projects.publicTabVisibility,
            readmePublishedVersionId: projectReadmes.publishedVersionId,
        })
        .from(projectReadmeAssets)
        .innerJoin(projects, eq(projects.id, projectReadmeAssets.projectId))
        .leftJoin(projectReadmes, eq(projectReadmes.projectId, projectReadmeAssets.projectId))
        .where(
            and(
                eq(projectReadmeAssets.projectId, projectId),
                eq(projectReadmeAssets.id, assetId),
                isNull(projectReadmeAssets.deletedAt),
                isNull(projects.deletedAt),
            ),
        )
        .limit(1);

    if (!row) return jsonError("Not found", 404, "NOT_FOUND");

    const membership = user
        ? await db.query.projectMembers.findFirst({
            where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)),
            columns: { userId: true },
        })
        : null;

    const isMember = Boolean(user && (user.id === row.ownerId || membership));
    const isPublishedPublic =
        row.visibility === "public" &&
        normalizeProjectPublicTabVisibility(row.publicTabVisibility).readme &&
        Boolean(row.readmePublishedVersionId);

    if (!isMember && !isPublishedPublic) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const admin = await createAdminClient();
    const signedUrlTtlSeconds = isPublishedPublic ? 60 * 60 : 60;
    const { data: signedData, error: signError } = await admin.storage
        .from(row.bucket)
        .createSignedUrl(row.storageKey, signedUrlTtlSeconds);
    if (signError || !signedData?.signedUrl) {
        logger.warn("project_readme.asset_route_presign_failed", {
            module: "projects",
            projectId,
            assetId,
            bucket: row.bucket,
            key: row.storageKey,
            error: signError?.message || "Missing signed URL",
        });
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const response = NextResponse.redirect(signedData.signedUrl, 302);
    response.headers.set(
        "Cache-Control",
        isPublishedPublic
            ? "public, max-age=900, s-maxage=900, stale-while-revalidate=86400"
            : "private, no-store",
    );
    response.headers.set("CDN-Cache-Control", isPublishedPublic ? "public, max-age=900, stale-while-revalidate=86400" : "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
}
