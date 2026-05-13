import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { logger } from "@/lib/logger";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const { id: projectId } = await context.params;
    if (!UUID_RE.test(projectId)) {
        return new Response("Not found", { status: 404 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await getProjectAccessById(projectId, user?.id ?? null);
    if (!access.project || !access.canRead) {
        return new Response("Not found", { status: 404 });
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
        return new Response("Not found", { status: 404 });
    }

    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(project.bucket).download(project.key);
    if (error || !data) {
        logger.warn("project.image_route_download_failed", {
            module: "projects",
            projectId,
            bucket: project.bucket,
            key: project.key,
            error: error?.message || "Missing storage object",
        });
        return new Response("Not found", { status: 404 });
    }

    const isPublicRequest = !user && access.canRead;
    return new Response(data, {
        status: 200,
        headers: {
            "Content-Type": data.type || "image/jpeg",
            "Cache-Control": isPublicRequest
                ? "public, max-age=300, s-maxage=300, stale-while-revalidate=86400"
                : "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
