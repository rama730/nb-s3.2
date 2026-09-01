"use server";

import { z } from "zod";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  projects,
  githubSyncConnections,
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
  validateReviewedLocalFiles,
  readStoredSyncContent,
} from "@/lib/github/sync-service";
import {
  repoApi,
  syncGithub,
  readGitHubBlob,
  requireExistingOrEmptyBranch,
  type SyncRepo,
} from "@/lib/github/sync-api";
import { redactSyncManifest } from "@/lib/github/sync-contract";
import {
  buildGithubAccountConnectionState,
} from "@/lib/github/connection-state";
import { assertProjectFileReadAccess } from "@/lib/files/internal-helpers";
import { ensureDefaultGithubContributorIdentity } from "@/lib/github/contributor-identity";
import { resolveGithubUserAccessToken } from "@/lib/github/user-access-token";

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
        WHERE event.project_id=${projectId} AND event.type='file_content_contributed'
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
    const choices = z
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
      .min(1)
      .max(500)
      .parse(selection);
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
    if (["completed", "running", "queued"].includes(run.status))
      return syncRunView(run);
    if (!["review", "failed"].includes(run.status))
      throw new Error("Prepare a new review before synchronizing");
    if (
      !run.result.pushed &&
      !run.result.commitSha &&
      Date.now() - run.createdAt.getTime() > 55 * 60_000
    )
      throw new Error("This review expired. Compare and review again.");
    if (!run.result.pushed && !run.result.commitSha)
      await validateReviewedLocalFiles(
        projectId,
        run.manifest,
        run.result.applied,
      );
    const limit = await consumeRateLimit(`github:execute:${user.id}`, 20, 3600);
    if (!limit.allowed)
      throw new Error("Sync rate limit reached. Try again later.");
    const [queued] = await db
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
    if (!queued)
      throw new Error("Operation state changed. Reopen the sync workspace.");
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
export async function getGitHubCommitIdentityOptions() {
  return result(async () => {
    const { token } = await session();
    if (!token)
      throw new Error("Reconnect GitHub to authorize your commit identity");
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
