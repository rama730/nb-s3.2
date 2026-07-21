import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { jsonSuccess, requireAuthenticatedUser, enforceRouteLimit } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import { resolveGithubExternalAccountHealth } from "@/lib/github/account-health";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { buildIntegrationsData } from "@/lib/settings/integrations";

export async function GET(request: Request) {
    const auth = await requireAuthenticatedUser();
    if (!auth.user || auth.response) {
        return auth.response || new Response("Unauthorized", { status: 401 });
    }

    const { user } = auth;
    const limitResponse = await enforceRouteLimit(request, `api:integrations:${user.id}`, 60, 60);
    if (limitResponse) return limitResponse;

    const githubConnection = buildGithubAccountConnectionState(user);
    const githubAccountHealthPromise = resolveGithubExternalAccountHealth({
        linked: githubConnection.linked,
        username: githubConnection.username,
    });

    const githubProjectsRows = await db
        .select({
            id: projects.id,
            githubLastSyncAt: projects.githubLastSyncAt,
        })
        .from(projects)
        .where(
            and(
                sql`(${projects.ownerId} = ${user.id} OR exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${user.id}))`,
                isNull(projects.deletedAt),
                isNotNull(projects.githubRepoUrl),
            ),
        )
        .orderBy(sql`${projects.updatedAt} DESC`);

    const githubLastSyncAt = githubProjectsRows.reduce<string | null>((latest, row) => {
        const value = row.githubLastSyncAt?.toISOString() ?? null;
        return value && (!latest || value > latest) ? value : latest;
    }, null);

    const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);
    const githubAccountHealth = await githubAccountHealthPromise;

    return jsonSuccess(
        buildIntegrationsData({
            user,
            githubRepoProjectCount: githubProjectsRows.length,
            githubLastSyncAt,
            passwordLastChangedAt: passwordLastChangedAt ?? null,
            githubAccountHealth,
        }),
    );
}
