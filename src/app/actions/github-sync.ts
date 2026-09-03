"use server";

import { z } from "zod";
import { and, count, eq, desc, inArray, isNull, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  projects,
  profiles,
  projectMembers,
  tasks,
  githubSyncConnections,
  githubSyncFiles,
  githubSyncRuns,
  githubContributorIdentities,
} from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { inngest } from "@/inngest/client";
import { createSignedJobRequestToken } from "@/lib/security/job-request";
import {
  normalizeGithubBranch,
  normalizeGithubRepoUrl,
} from "@/lib/github/repo-validation";
import {
  sanitizeGitErrorMessage,
  sealGithubImportToken,
} from "@/lib/github/repo-security";
import {
  compareSync,
  createSyncReview,
  requireSyncOwner,
  resolveSyncContext,
  syncRunView,
  readStoredSyncContent,
} from "@/lib/github/sync-service";
import {
  repoApi,
  syncGithub,
  readGitHubBlob,
  requireExistingOrEmptyBranch,
  assertGithubWorkflowPermission,
  type SyncRepo,
} from "@/lib/github/sync-api";
import { redactSyncManifest } from "@/lib/github/sync-contract";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { assertProjectFileReadAccess } from "@/lib/files/internal-helpers";
import { ensureDefaultGithubContributorIdentity } from "@/lib/github/contributor-identity";
import { resolveGithubUserAccessToken } from "@/lib/github/user-access-token";
import { GITHUB_SYNC_LIMITS } from "@/lib/github/sync-limits";

const idSchema = z.string().uuid();
const compareSchema = z.object({
  direction: z.enum(["push", "pull"]),
  branch: z.string().min(1).max(255),
  mode: z.enum(["direct", "pr"]).default("pr"),
  newRepository: z
    .object({
      owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
      name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
      private: z.boolean().default(true),
      organization: z.boolean(),
    })
    .optional(),
});
const syncSelectionSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(2048),
      resolution: z.enum(["edge", "github", "merge"]).optional(),
      content: z
        .string()
        .max(1024 * 1024)
        .optional(),
      expectedLocalHash: z.string().nullable(),
      expectedRemoteSha: z.string().nullable(),
    }),
  )
  .min(1, "Select at least one file")
  .max(
    GITHUB_SYNC_LIMITS.operationFiles,
    `Select no more than ${GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files per operation`,
  );
async function session() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  const {
    data: { session: value },
  } = await client.auth.getSession();
  const token = await resolveGithubUserAccessToken(user, value);
  return { user, token };
}
async function result<T>(
  work: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    return { success: true, data: await work() };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        success: false,
        error: error.issues[0]?.message || "Check the submitted information",
      };
    return { success: false, error: sanitizeGitErrorMessage(error) };
  }
}
export async function getGitHubSyncState(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token);
    const runs = await db
      .select()
      .from(githubSyncRuns)
      .where(eq(githubSyncRuns.projectId, projectId))
      .orderBy(desc(githubSyncRuns.createdAt))
      .limit(20);
    let identity = await db.query.githubContributorIdentities.findFirst({
      where: eq(githubContributorIdentities.userId, user.id),
    });
    if (!identity && token) {
      await ensureDefaultGithubContributorIdentity(user.id, token).catch(
        () => null,
      );
      identity = await db.query.githubContributorIdentities.findFirst({
        where: eq(githubContributorIdentities.userId, user.id),
      });
    }

    const [filesCountResult, membersResult] = await Promise.all([
      db
        .select({ count: count() })
        .from(githubSyncFiles)
        .where(eq(githubSyncFiles.projectId, projectId)),
      db
        .select({
          userId: projectMembers.userId,
          fullName: profiles.fullName,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
          membershipRole: projectMembers.role,
          githubLogin: githubContributorIdentities.login,
          githubEmail: githubContributorIdentities.email,
        })
        .from(projectMembers)
        .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
        .leftJoin(
          githubContributorIdentities,
          eq(githubContributorIdentities.userId, projectMembers.userId),
        )
        .where(eq(projectMembers.projectId, projectId))
        .limit(12),
    ]);

    return {
      account: buildGithubAccountConnectionState(user),
      connection: ctx.connection
        ? {
            repository: ctx.connection.repository,
            branch: ctx.connection.branch,
            incomingSha: ctx.connection.incomingSha,
          }
        : ctx.repository
          ? {
              repository: ctx.repository,
              branch: ctx.project.githubDefaultBranch || "main",
              incomingSha: null,
            }
          : null,
      canAuthenticate: !!ctx.token,
      identity: identity
        ? { login: identity.login, email: identity.email }
        : null,
      filesCount: filesCountResult[0]?.count ?? 0,
      teamMembers: membersResult.map((m) => ({
        userId: m.userId,
        name: m.fullName || m.username || "Team Member",
        avatarUrl: m.avatarUrl,
        membershipRole: m.membershipRole,
        githubLogin: m.githubLogin,
        githubEmail: m.githubEmail,
      })),
      runs: runs.map(syncRunView),
    };
  });
}
export async function getGitHubSyncContributors(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user } = await session();
    const access = await assertProjectFileReadAccess(projectId, user.id);
    if (!access.isOwner && !access.isMember)
      throw new Error(
        "Project membership is required to view file contribution activity",
      );
    const rows = await db.execute<{
      user_id: string | null;
      contributor_key: string;
      name: string;
      username: string | null;
      avatar_url: string | null;
      github_login: string | null;
      files: number;
    }>(sql`
      WITH evidence AS (
        SELECT event.actor_id,event.node_id,NULL::text AS github_id,NULL::text AS name,NULL::text AS login,NULL::text AS avatar
        FROM project_node_events event
        WHERE event.project_id=${projectId} AND event.type IN ('file_content_contributed', 'create_file')
        UNION SELECT node.created_by,node.id,NULL,NULL,NULL,NULL FROM project_nodes node
        WHERE node.project_id=${projectId} AND node.created_by IS NOT NULL AND node.git_blob_hash IS NULL
        UNION SELECT version.uploaded_by,version.node_id,NULL,NULL,NULL,NULL FROM file_versions version
        JOIN project_nodes node ON node.id=version.node_id WHERE node.project_id=${projectId}
          AND node.git_blob_hash IS NULL AND version.attribution='{}'::jsonb
        UNION SELECT identity.user_id,event.node_id,author->>'githubId',author->>'name',author->>'githubLogin',author->>'avatarUrl'
        FROM project_node_events event
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(event.metadata->'attribution'->'contributors')='array' THEN event.metadata->'attribution'->'contributors' ELSE '[]'::jsonb END) AS author
        LEFT JOIN github_contributor_identities identity ON identity.github_id::text=author->>'githubId'
        WHERE event.project_id=${projectId} AND event.type='file_content_contributed' AND event.metadata->>'source'='github'
      ), normalized AS (
        SELECT evidence.node_id,p.id AS user_id,
          COALESCE(p.id::text,'github:'||evidence.github_id,'unlinked:'||evidence.name) AS contributor_key,
          COALESCE(p.full_name,p.username,evidence.name,'Contributor') AS name,
          p.username,COALESCE(p.avatar_url,evidence.avatar) AS avatar_url,
          COALESCE(identity.login,evidence.login) AS github_login
      FROM evidence LEFT JOIN profiles p ON p.id=evidence.actor_id
      JOIN project_nodes node ON node.id=evidence.node_id AND node.task_id IS NULL AND node.canonical_node_id IS NULL
        AND node.deleted_at IS NULL AND node.path NOT LIKE '/.system/%'
      LEFT JOIN github_contributor_identities identity ON identity.user_id=p.id
      WHERE p.deleted_at IS NULL AND (p.id IS NOT NULL OR evidence.name IS NOT NULL)
      ) SELECT contributor_key,user_id,max(name) AS name,max(username) AS username,max(avatar_url) AS avatar_url,
        max(github_login) AS github_login,count(DISTINCT node_id)::int AS files
      FROM normalized GROUP BY contributor_key,user_id ORDER BY files DESC,contributor_key LIMIT 200
    `);
    return Array.from(rows).map((row) => ({
      userId: row.user_id,
      key: row.contributor_key,
      name: row.name,
      username: row.username,
      avatarUrl: row.avatar_url,
      githubLogin: row.github_login,
      files: row.files,
    }));
  });
}
export async function connectGitHubSyncRepository(
  projectId: string,
  repository: string,
  branch: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const normalized = normalizeGithubRepoUrl(repository);
    const normalizedBranch = normalizeGithubBranch(branch);
    if (!normalized || !normalizedBranch)
      throw new Error("Choose a valid repository and branch");
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token, normalized);
    if (!token)
      throw new Error(
        "Authorize your GitHub account before choosing a repository",
      );
    // A globally installed GitHub App is not evidence that this owner may connect any repository it can access.
    const repo = await syncGithub<SyncRepo>(token, repoApi(normalized));
    await requireExistingOrEmptyBranch(token, normalized, normalizedBranch);
    if (repo.archived || repo.permissions?.push === false || !ctx.token)
      throw new Error(
        "A writable repository and GitHub authorization are required",
      );
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`,
      );
      const active = await tx.query.githubSyncRuns.findFirst({
        where: and(
          eq(githubSyncRuns.projectId, projectId),
          inArray(githubSyncRuns.status, ["queued", "running"]),
        ),
      });
      if (active)
        throw new Error(
          "Wait for the current sync operation before changing the connection",
        );
      const current = await tx.query.githubSyncConnections.findFirst({
        where: eq(githubSyncConnections.projectId, projectId),
      });
      await tx
        .insert(githubSyncConnections)
        .values({
          projectId,
          repository: normalized,
          repositoryId: repo.id,
          branch: normalizedBranch,
          installationId: ctx.access?.installationId,
        })
        .onConflictDoUpdate({
          target: githubSyncConnections.projectId,
          set: {
            repository: normalized,
            repositoryId: repo.id,
            branch: normalizedBranch,
            installationId: ctx.access?.installationId,
            version: (current?.version || 0) + 1,
            incomingSha: null,
            updatedAt: new Date(),
          },
        });
      await tx
        .update(projects)
        .set({
          githubRepoUrl: normalized,
          githubDefaultBranch: normalizedBranch,
        })
        .where(eq(projects.id, projectId));
    });
    return { repository: normalized, branch: normalizedBranch };
  });
}
export async function disconnectGitHubSyncRepository(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user } = await session();
    await requireSyncOwner(projectId, user.id);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`,
      );
      if (
        await tx.query.githubSyncRuns.findFirst({
          where: and(
            eq(githubSyncRuns.projectId, projectId),
            inArray(githubSyncRuns.status, ["queued", "running"]),
          ),
        })
      )
        throw new Error(
          "Wait for synchronization to finish before disconnecting",
        );
      await tx
        .delete(githubSyncConnections)
        .where(eq(githubSyncConnections.projectId, projectId));
      await tx
        .update(projects)
        .set({ githubRepoUrl: null, githubDefaultBranch: null })
        .where(eq(projects.id, projectId));
      await tx
        .update(githubSyncRuns)
        .set({
          status: "cancelled",
          credential: null,
          stage: "Connection removed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.projectId, projectId),
            inArray(githubSyncRuns.status, [
              "review",
              "failed",
              "needs_review",
            ]),
          ),
        );
    });
    return { disconnected: true };
  });
}
export async function compareGitHubSync(
  projectId: string,
  input: z.input<typeof compareSchema>,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const parsed = compareSchema.parse(input);
    const { user, token } = await session();
    const limit = await consumeRateLimit(`github:compare:${user.id}`, 30, 60);
    if (!limit.allowed)
      throw new Error("Too many comparisons. Please try again shortly.");
    return redactSyncManifest(
      await compareSync(
        await resolveSyncContext(projectId, user.id, token),
        parsed,
      ),
    );
  });
}
export async function prepareGitHubSync(
  projectId: string,
  input: z.input<typeof compareSchema>,
  selection: unknown,
  message: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const parsed = compareSchema.parse(input);
    const choices = syncSelectionSchema.parse(selection);
    const safeMessage = z.string().trim().min(1).max(2000).parse(message);
    if (
      /^(co-authored-by|signed-off-by|edge-sync-operation):/im.test(safeMessage)
    )
      throw new Error(
        "Authorship trailers are added automatically from verified contributor identities",
      );
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token);
    const limit = await consumeRateLimit(`github:prepare:${user.id}`, 15, 60);
    if (!limit.allowed)
      throw new Error("Too many prepared reviews. Please try again shortly.");
    const manifest = await compareSync(ctx, parsed);
    for (const choice of choices) {
      const file = manifest.files.find((f) => f.path === choice.path);
      if (
        !file ||
        file.localHash !== choice.expectedLocalHash ||
        file.remoteSha !== choice.expectedRemoteSha
      )
        throw new Error(
          `Changes were updated since comparison: ${choice.path}. Compare again.`,
        );
    }
    return createSyncReview(ctx, manifest, choices, safeMessage);
  });
}
export async function executeGitHubSync(projectId: string, runId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    idSchema.parse(runId);
    const { user, token } = await session();
    await requireSyncOwner(projectId, user.id);
    const run = await db.query.githubSyncRuns.findFirst({
      where: and(
        eq(githubSyncRuns.id, runId),
        eq(githubSyncRuns.projectId, projectId),
        eq(githubSyncRuns.actorId, user.id),
      ),
    });
    if (!run) throw new Error("Sync review not found");
    if (["completed", "running"].includes(run.status)) return syncRunView(run);
    if (!["review", "failed", "queued"].includes(run.status))
      throw new Error("Prepare a new review before synchronizing");
    if (run.manifest.direction === "push")
      await assertGithubWorkflowPermission(
        token,
        run.manifest.files.map((file) => file.path),
      );
    let queued = run;
    if (run.status !== "queued") {
      if (
        !run.result.pushed &&
        !run.result.commitSha &&
        Date.now() - run.createdAt.getTime() > 55 * 60_000
      )
        throw new Error("This review expired. Compare and review again.");
      const limit = await consumeRateLimit(
        `github:execute:${user.id}`,
        20,
        3600,
      );
      if (!limit.allowed)
        throw new Error("Sync rate limit reached. Try again later.");
      const rows = await db
        .update(githubSyncRuns)
        .set({
          status: "queued",
          error: null,
          ...(token
            ? { credential: sealGithubImportToken(token, 60 * 60_000) }
            : {}),
          stage: "Queued for synchronization",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.id, runId),
            inArray(githubSyncRuns.status, ["review", "failed"]),
          ),
        )
        .returning();
      if (!rows[0])
        throw new Error("Operation state changed. Reopen the sync workspace.");
      queued = rows[0];
    }
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.GITHUB_SYNC_INLINE_FALLBACK?.trim().toLowerCase() === "always"
    ) {
      // ponytail: local development has no separately reachable worker.
      const { runReviewedGitHubSync } =
        await import("@/lib/github/sync-runner");
      await runReviewedGitHubSync(runId, user.id, projectId);
      const finished = await db.query.githubSyncRuns.findFirst({
        where: and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.projectId, projectId),
          eq(githubSyncRuns.actorId, user.id),
        ),
      });
      if (!finished) throw new Error("Synchronization result was not retained");
      return syncRunView(finished);
    }
    try {
      await inngest.send({
        name: queued.manifest.direction === "push" ? "git/push" : "git/pull",
        id: `reviewed-sync:${runId}:${queued.updatedAt.getTime()}`,
        data: {
          projectId,
          userId: user.id,
          runId,
          commitMessage: queued.manifest.message,
          jobSignature: createSignedJobRequestToken({
            kind: `git/${queued.manifest.direction}`,
            actorId: user.id,
            subjectId: runId,
            ttlSeconds: 3600,
          }),
        },
      });
    } catch {
      /* Durable queued row is dispatched by the recovery job. */
    }
    return syncRunView(queued);
  });
}
export async function cancelGitHubSyncReview(projectId: string, runId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    idSchema.parse(runId);
    const { user } = await session();
    await requireSyncOwner(projectId, user.id);
    await db
      .update(githubSyncRuns)
      .set({
        status: "cancelled",
        credential: null,
        stage: "Cancelled",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.projectId, projectId),
          eq(githubSyncRuns.actorId, user.id),
          inArray(githubSyncRuns.status, [
            "review",
            "queued",
            "failed",
            "needs_review",
          ]),
        ),
      );
    return { cancelled: true };
  });
}
export async function getGitHubSyncDiff(
  projectId: string,
  input: z.input<typeof compareSchema>,
  path: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token);
    const manifest = await compareSync(ctx, compareSchema.parse(input));
    const file = manifest.files.find((f) => f.path === path);
    if (!file || file.blocked)
      throw new Error("File is unavailable for comparison");
    if (file.size > 1024 * 1024)
      return { binary: true, edge: "", github: "", base: "" };
    const [edge, github, base] = await Promise.all([
      file.storageKey
        ? readStoredSyncContent(projectId, file.storageKey)
        : null,
      file.remoteSha
        ? readGitHubBlob(ctx.token, manifest.repository, file.remoteSha)
        : null,
      file.baseSha
        ? readGitHubBlob(ctx.token, manifest.repository, file.baseSha)
        : null,
    ]);
    const binary = [edge, github, base].some((buffer) => buffer?.includes(0));
    return {
      binary,
      edge: binary ? "" : edge?.toString("utf8") || "",
      github: binary ? "" : github?.toString("utf8") || "",
      base: binary ? "" : base?.toString("utf8") || "",
    };
  });
}

export async function getHeaderGitHubSyncStatus(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user } = await session();
    await assertProjectFileReadAccess(projectId, user.id);

    const [connection, latestRun] = await Promise.all([
      db.query.githubSyncConnections.findFirst({
        where: eq(githubSyncConnections.projectId, projectId),
      }),
      db.query.githubSyncRuns.findFirst({
        where: eq(githubSyncRuns.projectId, projectId),
        orderBy: [desc(githubSyncRuns.createdAt)],
        columns: {
          id: true,
          status: true,
          stage: true,
          manifest: true,
          result: true,
          createdAt: true,
        },
      }),
    ]);

    if (!connection) {
      return {
        connected: false,
        repository: null as string | null,
        branch: null as string | null,
        hasIncoming: false,
        activeRun: null as {
          id: string;
          stage: string;
          direction: "push" | "pull";
        } | null,
        latestRunStatus: null as string | null,
        latestCommitSha: null as string | null,
        latestDirection: null as "push" | "pull" | null,
        latestSyncAt: null as string | null,
        syncComment: null as string | null,
      };
    }

    const isActive =
      latestRun &&
      (latestRun.status === "running" || latestRun.status === "queued");

    const commitSha =
      (latestRun?.result as Record<string, unknown> | undefined)?.commitSha ||
      connection.incomingSha ||
      null;
    const shortSha =
      typeof commitSha === "string" && commitSha.length >= 7
        ? commitSha.slice(0, 7)
        : typeof commitSha === "string"
        ? commitSha
        : null;

    const direction = (latestRun?.manifest?.direction || "push") as "push" | "pull";
    const branchName = connection.branch || "main";
    const repoName = connection.repository.replace(/^https:\/\/github\.com\//, "");

    const syncComment = shortSha
      ? `The last sync was to GitHub for ${repoName}, to the ${branchName} branch, and this is the code commit: ${shortSha}`
      : `The last sync was to GitHub for ${repoName}, to the ${branchName} branch`;

    return {
      connected: true,
      repository: connection.repository.replace(/^https:\/\/github\.com\//, ""),
      branch: connection.branch,
      hasIncoming: Boolean(connection.incomingSha),
      activeRun: isActive
        ? {
            id: latestRun.id,
            stage: latestRun.stage,
            direction,
          }
        : null,
      latestRunStatus: latestRun?.status ? String(latestRun.status) : null,
      latestCommitSha: shortSha,
      latestDirection: direction,
      latestSyncAt: latestRun?.createdAt ? latestRun.createdAt.toISOString() : null,
      syncComment,
    };
  });
}

export async function getCurrentGitHubCommitIdentity() {
  return result(async () => {
    const { user } = await session();
    const contributor = await db.query.githubContributorIdentities.findFirst({
      where: eq(githubContributorIdentities.userId, user.id),
    });

    if (contributor) {
      return {
        configured: true,
        login: contributor.login,
        email: contributor.email,
        githubId: contributor.githubId,
        avatarUrl: contributor.avatarUrl,
        isNoreply: contributor.email.includes("noreply.github.com"),
      };
    }

    const identitiesResult = await db.execute<{
      id: string;
      provider: string;
      identity_data: Record<string, unknown> | null;
    }>(
      sql`SELECT id, provider, identity_data FROM auth.identities WHERE user_id = ${user.id}::uuid AND provider = 'github' ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
    ).catch(() => null);

    const primaryGithub =
      identitiesResult && Array.isArray(identitiesResult) && identitiesResult.length > 0
        ? identitiesResult[0]
        : null;

    if (primaryGithub) {
      const identityData = (primaryGithub.identity_data || {}) as Record<string, unknown>;
      const githubId = Number(identityData.provider_id || identityData.sub || 0);
      const login = String(identityData.user_name || identityData.preferred_username || "user");
      const defaultEmail = githubId && login
        ? `${githubId}+${login}@users.noreply.github.com`
        : (typeof identityData.email === "string" ? identityData.email : "");

      return {
        configured: false,
        login,
        email: defaultEmail,
        githubId,
        avatarUrl: String(identityData.avatar_url || ""),
        isNoreply: defaultEmail.includes("noreply.github.com"),
      };
    }

    return null;
  });
}

export async function getGitHubCommitIdentityOptions() {
  return result(async () => {
    const { user, token } = await session();

    // If an active GitHub token is available, query live verified emails from GitHub API
    if (token) {
      try {
        const account = await syncGithub<{
          id: number;
          login: string;
          name: string | null;
          avatar_url: string;
        }>(token, "/user");
        const emails = await syncGithub<
          Array<{ email: string; verified: boolean }>
        >(token, "/user/emails");
        return {
          account,
          emails: [
            ...new Set([
              ...emails.filter((e) => e.verified).map((e) => e.email),
              `${account.id}+${account.login}@users.noreply.github.com`,
            ]),
          ],
        };
      } catch {
        // Fall through to database identities if GitHub token is expired or unavailable
      }
    }

    // Fall back to verified identities attached to this user in the database
    const [identitiesResult, contributor] = await Promise.all([
      db.execute<{
        id: string;
        provider: string;
        identity_data: Record<string, unknown> | null;
      }>(
        sql`SELECT id, provider, identity_data FROM auth.identities WHERE user_id = ${user.id}::uuid AND provider = 'github' ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
      ).catch(() => null),
      db.query.githubContributorIdentities.findFirst({
        where: eq(githubContributorIdentities.userId, user.id),
      }).catch(() => null),
    ]);

    const primaryGithub =
      identitiesResult && Array.isArray(identitiesResult) && identitiesResult.length > 0
        ? identitiesResult[0]
        : null;

    if (!primaryGithub && !contributor) {
      throw new Error("Connect your GitHub account first to configure commit attribution");
    }

    const identityData = (primaryGithub?.identity_data || {}) as Record<string, unknown>;
    const githubId =
      contributor?.githubId ??
      Number(identityData.provider_id || identityData.sub || 0);
    const login =
      contributor?.login ??
      String(identityData.user_name || identityData.preferred_username || "user");
    const name =
      contributor?.name ??
      (typeof identityData.full_name === "string" ? identityData.full_name : null);
    const avatarUrl =
      contributor?.avatarUrl ??
      String(identityData.avatar_url || "");

    const emails = new Set<string>();
    if (githubId && login) {
      emails.add(`${githubId}+${login}@users.noreply.github.com`);
    }
    if (typeof identityData.email === "string" && identityData.email.trim()) {
      emails.add(identityData.email.trim());
    }
    if (contributor?.email && contributor.email.trim()) {
      emails.add(contributor.email.trim());
    }

    return {
      account: {
        id: githubId,
        login,
        name,
        avatar_url: avatarUrl,
      },
      emails: [...emails],
    };
  });
}
export async function approveGitHubCommitIdentity(email: string) {
  return result(async () => {
    const { user } = await session();
    const options = await getGitHubCommitIdentityOptions();
    if (!options.success) throw new Error(options.error);
    if (!options.data.emails.includes(email))
      throw new Error("Choose an email associated with your GitHub account");
    const { account } = options.data;
    const values = {
      githubId: account.id,
      login: account.login,
      name: account.name || account.login,
      email,
      avatarUrl: account.avatar_url,
      approvedAt: new Date(),
    };
    await db
      .insert(githubContributorIdentities)
      .values({ userId: user.id, ...values })
      .onConflictDoUpdate({
        target: githubContributorIdentities.userId,
        set: values,
      });
    return { login: account.login };
  });
}

export async function getProjectSyncTasks(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user } = await session();
    await assertProjectFileReadAccess(projectId, user.id);
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      columns: { key: true },
    });
    const candidateTasks = await db.query.tasks.findMany({
      where: and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)),
      columns: {
        id: true,
        title: true,
        taskNumber: true,
      },
      limit: 50,
      orderBy: [desc(tasks.updatedAt)],
    });
    const projectKey = project?.key || "TASK";
    return candidateTasks.map((t) => ({
      id: t.id,
      title: t.title,
      key: t.taskNumber ? `${projectKey}-${t.taskNumber}` : t.id.slice(0, 8),
    }));
  });
}

