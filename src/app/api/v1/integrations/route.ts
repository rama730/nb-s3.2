import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { jsonError, jsonSuccess, requireAuthenticatedUser, enforceRouteLimit } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import { buildIntegrationsData } from "@/lib/settings/integrations";

export async function GET(request: Request) {
    const auth = await requireAuthenticatedUser();
    if (!auth.user || auth.response) {
        return auth.response || new Response("Unauthorized", { status: 401 });
    }

    const { user } = auth;
    const limitResponse = await enforceRouteLimit(request, `api:integrations:${user.id}`, 60, 60);
    if (limitResponse) return limitResponse;

    const githubProjectsRows = await db
        .select({
            id: projects.id,
            title: projects.title,
            githubRepoUrl: projects.githubRepoUrl,
            githubDefaultBranch: projects.githubDefaultBranch,
            githubLastSyncAt: projects.githubLastSyncAt,
            githubLastCommitSha: projects.githubLastCommitSha,
            syncStatus: projects.syncStatus,
            importSource: projects.importSource,
            updatedAt: projects.updatedAt,
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

    // Auto-timeout stuck in-flight syncs (>15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    for (const row of githubProjectsRows) {
        const isStuck = 
            (row.syncStatus === "pending" || row.syncStatus === "cloning" || row.syncStatus === "indexing") &&
            row.updatedAt &&
            new Date(row.updatedAt) < fifteenMinutesAgo;

        if (isStuck) {
            const src = row.importSource as any;
            const nextImportSource = {
                ...(src || {}),
                metadata: {
                    ...((src?.metadata || {}) as Record<string, unknown>),
                    lastError: "Synchronization timed out.",
                    syncPhase: "failed",
                    syncProgress: null,
                },
            };

            await db
                .update(projects)
                .set({
                    syncStatus: "failed",
                    importSource: nextImportSource as any,
                    updatedAt: new Date(),
                })
                .where(eq(projects.id, row.id));

            row.syncStatus = "failed";
            row.importSource = nextImportSource;
        }
    }

    const githubProjects = githubProjectsRows.map((row) => {
        const src = row.importSource as any;
        const metadata = src?.metadata || {};
        return {
            id: row.id,
            title: row.title || "Untitled Project",
            repoUrl: row.githubRepoUrl || "",
            defaultBranch: row.githubDefaultBranch || "main",
            lastSyncAt: row.githubLastSyncAt ? new Date(row.githubLastSyncAt).toISOString() : null,
            lastCommitSha: row.githubLastCommitSha || null,
            syncStatus: row.syncStatus || "ready",
            syncPhase: metadata.syncPhase || null,
            syncProgress: metadata.syncProgress || null,
        };
    });

    const githubRepoProjectCount = githubProjects.length;
    let githubLastSyncAt: string | null = null;
    for (const row of githubProjectsRows) {
        if (row.githubLastSyncAt) {
            const dateStr = new Date(row.githubLastSyncAt).toISOString().slice(0, 10);
            if (!githubLastSyncAt || dateStr > githubLastSyncAt) {
                githubLastSyncAt = dateStr;
            }
        }
    }

    const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);

    return jsonSuccess(
        buildIntegrationsData({
            user,
            githubRepoProjectCount,
            githubLastSyncAt,
            passwordLastChangedAt: passwordLastChangedAt ?? null,
            githubProjects,
        }),
    );
}
