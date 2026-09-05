import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { jsonSuccess, requireAuthenticatedUser, enforceRouteLimit } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import { resolveGithubExternalAccountHealth } from "@/lib/github/account-health";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { buildIntegrationsData } from "@/lib/settings/integrations";
import { toIsoString } from "@/lib/utils/date";

export async function GET(request: Request) {
    const auth = await requireAuthenticatedUser();
    if (!auth.user || auth.response) {
        return auth.response || new Response("Unauthorized", { status: 401 });
    }

    const { user } = auth;
    const limitResponse = await enforceRouteLimit(request, `api:integrations:${user.id}`, 60, 60);
    if (limitResponse) return limitResponse;

    const identitiesResult = await db.execute<{
        id: string;
        provider: string;
        identity_data: Record<string, unknown> | null;
    }>(
        sql`SELECT id, provider, identity_data FROM auth.identities WHERE user_id = ${user.id}::uuid ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
    ).catch(() => null);

    const liveIdentities = identitiesResult && Array.isArray(identitiesResult)
        ? identitiesResult.map((row) => ({
            id: String(row.id),
            provider: String(row.provider),
            identity_data: (row.identity_data || {}) as Record<string, unknown>,
        }))
        : [];

    const effectiveUser = liveIdentities.length > 0
        ? { ...user, identities: liveIdentities as any }
        : user;

    const githubConnection = buildGithubAccountConnectionState(effectiveUser);
    const githubAccountHealthPromise = resolveGithubExternalAccountHealth({
        linked: githubConnection.linked,
        githubId: githubConnection.githubId,
        username: githubConnection.username,
    });

    const [githubProjectsAggregate] = await db
        .select({
            count: sql<number>`count(*)::int`,
            githubLastSyncAt: sql<Date | string | null>`max(${projects.githubLastSyncAt})`,
        })
        .from(projects)
        .where(
            and(
                sql`(${projects.ownerId} = ${user.id} OR exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${user.id}))`,
                isNull(projects.deletedAt),
                isNotNull(projects.githubRepoUrl),
            ),
        );

    const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);
    const githubAccountHealth = await githubAccountHealthPromise;

    return jsonSuccess(
        buildIntegrationsData({
            user: effectiveUser,
            githubRepoProjectCount: githubProjectsAggregate?.count ?? 0,
            // ponytail: SQL aggregates bypass timestamp column mapping, so normalize at the API boundary.
            githubLastSyncAt: toIsoString(githubProjectsAggregate?.githubLastSyncAt),
            passwordLastChangedAt: passwordLastChangedAt ?? null,
            githubAccountHealth,
        }),
    );
}
