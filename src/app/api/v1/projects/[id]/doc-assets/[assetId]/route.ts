import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectMembers, projectMarkdownAssets, projectMarkdowns, projects } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { enforceRouteLimit, jsonError } from "@/app/api/v1/_shared";
import { resolveProjectDocPermission } from "@/lib/projects/doc";
import { isUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; assetId: string }> },
) {
    const limitResponse = await enforceRouteLimit(request, "api:v1:projects:readmeAssets", 120, 60);
    if (limitResponse) return limitResponse;

    const { id: projectId, assetId } = await context.params;
    if (!isUuid(projectId) || !isUuid(assetId)) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const [row] = await db
        .select({
            bucket: projectMarkdownAssets.bucket,
            storageKey: projectMarkdownAssets.storageKey,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            publicTabVisibility: projects.publicTabVisibility,
            readmeSettings: projectMarkdowns.settings,
            readmePublishedVersionId: projectMarkdowns.publishedVersionId,
        })
        .from(projectMarkdownAssets)
        .innerJoin(projects, eq(projects.id, projectMarkdownAssets.projectId))
        .leftJoin(projectMarkdowns, eq(projectMarkdowns.id, projectMarkdownAssets.markdownId))
        .where(
            and(
                eq(projectMarkdownAssets.projectId, projectId),
                eq(projectMarkdownAssets.id, assetId),
                isNull(projectMarkdownAssets.deletedAt),
                isNull(projects.deletedAt),
            ),
        )
        .limit(1);

    if (!row) return jsonError("Not found", 404, "NOT_FOUND");

    const membership = user
        ? await db.query.projectMembers.findFirst({
            where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)),
            columns: { role: true },
        })
        : null;

    const isOwner = Boolean(user && user.id === row.ownerId);
    const isMember = Boolean(isOwner || membership);
    const permission = resolveProjectDocPermission({
        actorUserId: user?.id,
        projectVisibility: row.visibility,
        publicTabVisibility: row.publicTabVisibility,
        settings: row.readmeSettings,
        membershipRole: isOwner ? "owner" : membership?.role,
        isOwner,
        isActiveMember: isMember,
        hasPublishedReadme: Boolean(row.readmePublishedVersionId),
    });

    if (!permission.canReadPublished && !permission.canEdit) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const isPublishedPublic = permission.accessLevel === "public";

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
