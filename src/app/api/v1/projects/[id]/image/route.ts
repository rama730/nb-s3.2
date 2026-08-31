import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { enforceRouteLimit, fetchWithBoundedRetry, jsonError } from "@/app/api/v1/_shared";
import { isLooseUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_CACHE_SECONDS = 5 * 60;

function coverVersion(storageKey: string) {
    return createHash("sha256").update(storageKey).digest("base64url").slice(0, 16);
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const limitResponse = await enforceRouteLimit(request, "api:v1:projects:image", 60, 60);
    if (limitResponse) return limitResponse;

    const { id: projectId } = await context.params;
    if (!isLooseUuid(projectId)) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await getProjectAccessById(projectId, user?.id ?? null);
    if (!access.project || !access.canRead) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const [project] = await db
        .select({
            bucket: projects.coverImageBucket,
            key: projects.coverImageKey,
            visibility: projects.visibility,
            status: projects.status,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

    if (!project?.bucket || !project.key) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const version = coverVersion(project.key);
    const isPublicRequest = !user && access.canRead;
    const cacheControl = isPublicRequest
        ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600"
        : `private, max-age=${PRIVATE_CACHE_SECONDS}, stale-while-revalidate=60`;
    if (request.nextUrl.searchParams.get("v") !== version) {
        const canonicalUrl = request.nextUrl.clone();
        canonicalUrl.searchParams.set("v", version);
        return new Response(null, {
            status: 307,
            headers: { Location: canonicalUrl.toString(), "Cache-Control": cacheControl, Vary: "Cookie, Authorization" },
        });
    }

    const etag = `"project-cover-${projectId}-${version}"`;
    if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": cacheControl, Vary: "Cookie, Authorization" },
        });
    }

    const admin = await createAdminClient();
    const { data: signedData, error: signError } = await admin.storage
        .from(project.bucket)
        .createSignedUrl(project.key, 60);

    if (signError || !signedData?.signedUrl) {
        logger.warn("project.image_route_presign_failed", {
            module: "projects",
            projectId,
            bucket: project.bucket,
            key: project.key,
            error: signError?.message || "Missing signed URL",
        });
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    let res: Response;
    try {
        res = await fetchWithBoundedRetry(signedData.signedUrl, {
            timeoutMs: 4_000,
            maxAttempts: 2,
        });
    } catch (error) {
        logger.warn("project.image_route_fetch_failed", {
            module: "projects",
            projectId,
            bucket: project.bucket,
            key: project.key,
            error: error instanceof Error ? error.message : String(error),
        });
        return jsonError("Not found", 404, "NOT_FOUND");
    }
    if (!res.ok) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    return new Response(res.body, {
        status: 200,
        headers: {
            "Content-Type": res.headers.get("content-type") || "image/jpeg",
            "Cache-Control": cacheControl,
            ETag: etag,
            Vary: "Cookie, Authorization",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
