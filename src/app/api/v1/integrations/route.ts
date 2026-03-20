import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import { buildIntegrationsData } from "@/lib/settings/integrations";

export async function GET() {
    const auth = await requireAuthenticatedUser();
    if (auth.response) {
        return auth.response;
    }

    const { user } = auth;
    if (!user) {
        return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const githubUsageRows = await db
        .select({
            count: sql<number>`count(*)::int`,
            lastSyncAt: sql<string | null>`max(${projects.githubLastSyncAt})::text`,
        })
        .from(projects)
        .where(
            and(
                eq(projects.ownerId, user.id),
                isNull(projects.deletedAt),
                isNotNull(projects.githubRepoUrl),
            ),
        );

    const githubUsage = githubUsageRows[0] ?? { count: 0, lastSyncAt: null };
    const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);

    return jsonSuccess(
        buildIntegrationsData({
            user,
            githubRepoProjectCount: githubUsage.count ?? 0,
            githubLastSyncAt: githubUsage.lastSyncAt ?? null,
            passwordLastChangedAt: passwordLastChangedAt ?? null,
        }),
    );
}
