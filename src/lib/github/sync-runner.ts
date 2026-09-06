import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  projectNodes,
  fileVersions,
  tasks,
  projectUpdates,
  githubSyncRuns,
  githubSyncConnections,
  githubSyncFiles,
  githubContributorIdentities,
} from "@/lib/db/schema";
import {
  resolveSyncContext,
  requireSyncOwner,
  readStoredSyncContent,
  validateReviewedLocalFiles,
} from "./sync-service";
import {
  readGitHubHead,
  repoApi,
  syncGithub,
  SyncGithubError,
  type SyncRepo,
} from "./sync-api";
import {
  openGithubImportToken,
  sanitizeGitErrorMessage,
} from "./repo-security";
import { publishGitSnapshot } from "./sync-git";
import {
  type SyncFile,
  type SyncManifest,
  type SyncContributor,
} from "./sync-contract";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import {
  withTransientFileLease,
  assertOwnedFileLease,
} from "@/lib/files/file-lock-service";
import {
  recordNodeEvent,
  assertProjectWriteAccessTx,
} from "@/lib/files/internal-helpers";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function ensureIncomingParent(
  tx: Transaction,
  projectId: string,
  path: string,
  actorId: string,
) {
  let parentId: string | null = null;
  let prefix = "";
  for (const segment of path.split("/").slice(0, -1)) {
    prefix += `/${segment}`;
    const existing = await tx.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.path, prefix),
        isNull(projectNodes.taskId),
        isNull(projectNodes.deletedAt),
      ),
    });
    if (existing && existing.type !== "folder")
      throw new Error("Incoming folder collides with a file");
    if (existing) parentId = existing.id;
    else {
      const created: Array<{ id: string }> = await tx
        .insert(projectNodes)
        .values({
          projectId,
          parentId,
          path: prefix,
          type: "folder",
          name: segment,
          createdBy: actorId,
        })
        .returning({ id: projectNodes.id });
      if (!created[0]) throw new Error("Unable to create folder");
      parentId = created[0].id;
    }
  }
  return parentId;
}
async function saveBaseline(
  tx: Transaction,
  projectId: string,
  manifest: SyncManifest,
  file: SyncFile,
  nodeId: string | null,
  commitSha: string,
  sequence: number,
) {
  const values = {
    nodeId,
    blobSha:
      manifest.direction === "pull"
        ? file.remoteSha
        : file.resultBlobSha || null,
    localHash:
      manifest.direction === "pull" ? file.resultHash || null : file.localHash,
    localBlobSha:
      manifest.direction === "pull"
        ? file.resultBlobSha || null
        : file.localBlobSha,
    commitSha,
    sequence,
  };
  await tx
    .insert(githubSyncFiles)
    .values({
      projectId,
      repositoryId: manifest.repositoryId!,
      branch: manifest.branch,
      path: file.path,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        githubSyncFiles.projectId,
        githubSyncFiles.repositoryId,
        githubSyncFiles.branch,
        githubSyncFiles.path,
      ],
      set: values,
    });
}
async function remoteAuthors(
  token: string | null,
  manifest: SyncManifest,
  file: SyncFile,
  deltaCache: Map<string, Promise<Set<string>>>,
  identityCache?: Map<number, Promise<any>>,
): Promise<SyncContributor[]> {
  let delta: Set<string> | null = null;
  if (file.baseCommit) {
    if (!deltaCache.has(file.baseCommit))
      deltaCache.set(
        file.baseCommit,
        (async () => {
          const shas = new Set<string>();
          for (let page = 1; page <= 20; page++) {
            const comparison = await syncGithub<{
              total_commits: number;
              commits: Array<{ sha: string }>;
            }>(
              token,
              `${repoApi(manifest.repository)}/compare/${file.baseCommit}...${manifest.headSha}?per_page=100&page=${page}`,
            );
            if (comparison.total_commits > 2000)
              throw new Error(
                "Incoming history exceeds the 2,000-commit safe attribution limit",
              );
            for (const commit of comparison.commits) shas.add(commit.sha);
            if (
              shas.size >= comparison.total_commits ||
              !comparison.commits.length
            )
              break;
          }
          return shas;
        })(),
      );
    delta = await deltaCache.get(file.baseCommit)!;
  }
  const commits = await syncGithub<
    Array<{
      sha: string;
      author: { id: number; login: string; avatar_url: string } | null;
      commit: { author: { name: string; email: string } };
    }>
  >(
    token,
    `${repoApi(manifest.repository)}/commits?sha=${manifest.headSha}&path=${encodeURIComponent(file.path)}&per_page=100`,
  );
  const result: SyncContributor[] = [];
  for (const commit of commits) {
    if (commit.sha === file.baseCommit) break;
    if (delta && !delta.has(commit.sha)) continue;
    const author = commit.author;
    if (
      result.some((item) =>
        author
          ? item.githubId === author.id
          : item.name === commit.commit.author.name,
      )
    )
      continue;
    let linked = null;
    if (author) {
      if (identityCache) {
        if (!identityCache.has(author.id)) {
          identityCache.set(
            author.id,
            db.query.githubContributorIdentities.findFirst({
              where: eq(githubContributorIdentities.githubId, author.id),
            }),
          );
        }
        linked = await identityCache.get(author.id);
      } else {
        linked = await db.query.githubContributorIdentities.findFirst({
          where: eq(githubContributorIdentities.githubId, author.id),
        });
      }
    }
    result.push({
      userId: linked?.userId || null,
      name: commit.commit.author.name,
      username: null,
      avatarUrl: author?.avatar_url || null,
      githubLogin: author?.login || null,
      githubId: author?.id || null,
      source: "github",
    });
    if (!file.baseCommit) break; // Initial import records latest attributable author, not fabricated complete history.
  }
  return result;
}

export async function runReviewedGitHubSync(
  runId: string,
  actorId: string,
  projectId: string,
) {
  const leaseId = randomUUID();
  const [run] = await db
    .update(githubSyncRuns)
    .set({
      status: "running",
      leaseId,
      leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
      stage: "Validating reviewed changes",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubSyncRuns.id, runId),
        eq(githubSyncRuns.projectId, projectId),
        eq(githubSyncRuns.actorId, actorId),
        eq(githubSyncRuns.status, "queued"),
      ),
    )
    .returning();
  if (!run) return { skipped: true };
  let manifest = run.manifest;
  let result = run.result;
  const update = async (
    values: Partial<typeof githubSyncRuns.$inferInsert>,
  ) => {
    const rows = await db
      .update(githubSyncRuns)
      .set({
        ...values,
        updatedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .where(
        and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.leaseId, leaseId),
          eq(githubSyncRuns.status, "running"),
        ),
      )
      .returning({ id: githubSyncRuns.id });
    if (!rows.length) throw new Error("Synchronization lease was lost");
  };
  try {
    const ctx = await resolveSyncContext(
      projectId,
      actorId,
      openGithubImportToken(run.credential),
      manifest.repository,
    );
    if (!ctx.token)
      throw new Error(
        "GitHub authorization expired. Reconnect and prepare a fresh review.",
      );
    if (
      (ctx.connection?.version || 0) !== manifest.connectionVersion &&
      !result.repositoryCreated
    )
      throw new Error("Connection changed after review");
    if (
      result.repositoryCreated &&
      ctx.connection &&
      (ctx.connection.repositoryId !== manifest.repositoryId ||
        ctx.connection.version !== manifest.connectionVersion + 1)
    )
      throw new Error("Connection changed after repository creation");
    if (!result.pushed && !result.commitSha)
      await validateReviewedLocalFiles(projectId, manifest, result.applied);
    if (manifest.newRepository && !result.repositoryCreated) {
      await update({ stage: "Creating repository" });
      const spec = manifest.newRepository;
      const marker = `NetworkBase synchronization ${runId}`;
      if (!spec.organization) {
        const account = await syncGithub<{ login: string }>(ctx.token, "/user");
        if (account.login.toLowerCase() !== spec.owner.toLowerCase())
          throw new Error(
            "Choose your authenticated GitHub account as the personal repository owner",
          );
      }
      let repo: SyncRepo;
      try {
        const existing = await syncGithub<SyncRepo>(
          ctx.token,
          repoApi(manifest.repository),
        );
        if (existing.description !== marker)
          throw new Error(
            "A repository with this name already exists. Choose it explicitly instead.",
          );
        repo = existing;
      } catch (error) {
        if (!(error instanceof SyncGithubError) || error.status !== 404)
          throw error;
        repo = await syncGithub<SyncRepo>(
          ctx.token,
          spec.organization
            ? `/orgs/${encodeURIComponent(spec.owner)}/repos`
            : "/user/repos",
          "POST",
          {
            name: spec.name,
            private: spec.private,
            auto_init: false,
            description: marker,
          },
        );
      }
      if (
        repo.full_name.toLowerCase() !==
        `${spec.owner}/${spec.name}`.toLowerCase()
      )
        throw new Error(
          "Created repository owner does not match the reviewed destination",
        );
      result = { ...result, repositoryCreated: true, repositoryId: repo.id };
      manifest = { ...manifest, repositoryId: repo.id };
      await update({ manifest, result });
    }
    if (result.repositoryCreated) {
      await db
        .insert(githubSyncConnections)
        .values({
          projectId,
          repository: manifest.repository,
          repositoryId: manifest.repositoryId!,
          branch: manifest.branch,
          version: manifest.connectionVersion + 1,
        })
        .onConflictDoUpdate({
          target: githubSyncConnections.projectId,
          set: {
            repository: manifest.repository,
            repositoryId: manifest.repositoryId!,
            branch: manifest.branch,
            installationId: null,
            version: manifest.connectionVersion + 1,
            updatedAt: new Date(),
          },
        });
      await db
        .update(projects)
        .set({
          githubRepoUrl: manifest.repository,
          githubDefaultBranch: manifest.branch,
        })
        .where(eq(projects.id, projectId));
    }
    const repo = await syncGithub<SyncRepo>(
      ctx.token,
      repoApi(manifest.repository),
    );
    if (repo.id !== manifest.repositoryId || repo.archived)
      throw new Error("Repository identity or availability changed");
    if (manifest.direction === "push") {
      if (repo.permissions?.push === false)
        throw new Error("GitHub write permission was removed");
      if (!result.pushed && result.commitSha && result.branch) {
        if (
          (await readGitHubHead(
            ctx.token,
            manifest.repository,
            result.branch,
          )) === result.commitSha
        ) {
          result = { ...result, pushed: true };
          await update({ result });
        }
      }
      if (!result.pushed) {
        if (
          (await readGitHubHead(
            ctx.token,
            manifest.repository,
            manifest.branch,
          )) !== manifest.headSha
        )
          throw new Error("GitHub changed after review. Compare again.");
        await update({ stage: "Preparing and publishing commit" });
        result = {
          ...result,
          ...(await publishGitSnapshot({
            manifest,
            runId,
            createdAt: run.createdAt,
            token: ctx.token,
            readContent: (key) => readStoredSyncContent(projectId, key),
            beforePush: async (commitSha, branch) => {
              await requireSyncOwner(projectId, actorId);
              // Content was verified while materializing the commit; only the
              // current node identities need a final race check before push.
              await validateReviewedLocalFiles(projectId, manifest, [], false);
              result = { ...result, commitSha, branch };
              await update({
                result,
                stage: "Pushing reviewed changes to GitHub",
              });
            },
          })),
        };
        await update({ result, stage: "Remote commit verified" });
      }
      if (manifest.mode === "pr") {
        await update({ stage: "Opening pull request" });
        const head = `${repo.full_name.split("/")[0]}:${result.branch}`;
        const existing = await syncGithub<
          Array<{ html_url: string; number: number }>
        >(
          ctx.token,
          `${repoApi(manifest.repository)}/pulls?head=${encodeURIComponent(head)}&base=${encodeURIComponent(manifest.branch)}&state=all`,
        );
        const pr =
          existing[0] ||
          (await syncGithub<{ html_url: string; number: number }>(
            ctx.token,
            `${repoApi(manifest.repository)}/pulls`,
            "POST",
            {
              title: (
                manifest.message.split("\n")[0] || "Update from NetworkBase"
              ).slice(0, 200),
              head: result.branch,
              base: manifest.branch,
              body: `Reviewed publication from NetworkBase.\n\nOperation: ${runId}\n\n${manifest.files.length} selected file(s).`,
            },
          ));
        result = {
          ...result,
          pullRequestUrl: pr.html_url,
          pullRequestNumber: pr.number,
          merged: false,
        };
      }
      // A PR branch is published but is not a baseline for the configured destination branch.
      if (manifest.mode === "direct")
        await db.transaction(async (tx) => {
          await assertProjectWriteAccessTx(tx, projectId, actorId);
          const locked = await tx.execute(
            sql`SELECT id FROM github_sync_runs WHERE id=${runId} AND lease_id=${leaseId} AND status='running' FOR UPDATE`,
          );
          if (!locked.length) throw new Error("Synchronization lease was lost");
          for (const file of manifest.files)
            await saveBaseline(
              tx,
              projectId,
              manifest,
              file,
              file.nodeId,
              result.commitSha!,
              manifest.sequence,
            );
        });
    } else {
      if (
        !manifest.headSha ||
        (await readGitHubHead(
          ctx.token,
          manifest.repository,
          manifest.branch,
        )) !== manifest.headSha
      )
        throw new Error(
          "GitHub changed after review. Compare incoming changes again.",
        );
      const deltaCache = new Map<string, Promise<Set<string>>>();
      const identityCache = new Map<number, Promise<any>>();
      let lastStageUpdate = 0;
      for (const file of manifest.files) {
        if (result.applied?.includes(file.path)) continue;
        const now = Date.now();
        // ponytail: throttle stage updates to at most once per 2 seconds to avoid saturating Postgres with per-file UPDATE queries
        if (now - lastStageUpdate > 2000) {
          lastStageUpdate = now;
          await update({ stage: `Applying ${file.path}` });
        }
        const authors = await remoteAuthors(
          ctx.token,
          manifest,
          file,
          deltaCache,
          identityCache,
        );
        const isRemote = !file.resolution || file.resolution === "github";
        const attribution = {
          source: isRemote ? "github" : "edge",
          repositoryId: manifest.repositoryId,
          commitSha: manifest.headSha,
          contributors: authors,
          importedBy: actorId,
          historyComplete: false,
          operationId: runId,
        };
        const nextApplied = [...(result.applied || []), file.path];
        const finish = async (tx: Transaction, nodeId: string | null) => {
          if (file.renamedFrom && nodeId) {
            const collision = await tx.query.projectNodes.findFirst({
              where: and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.path, `/${file.path}`),
                isNull(projectNodes.taskId),
                isNull(projectNodes.deletedAt),
              ),
            });
            if (collision)
              throw new Error("Rename destination appeared after review");
            const parentId = await ensureIncomingParent(
              tx,
              projectId,
              file.path,
              actorId,
            );
            await tx
              .update(projectNodes)
              .set({
                parentId,
                path: `/${file.path}`,
                name: file.path.split("/").at(-1)!,
                updatedAt: new Date(),
              })
              .where(eq(projectNodes.id, nodeId));
            await saveBaseline(
              tx,
              projectId,
              manifest,
              {
                ...file,
                path: file.renamedFrom,
                remoteSha: null,
                resultHash: undefined,
                resultBlobSha: undefined,
              },
              null,
              manifest.headSha!,
              manifest.sequence,
            );
            await recordNodeEvent(
              projectId,
              actorId,
              nodeId,
              "github_file_moved",
              { operationId: runId, from: file.renamedFrom, to: file.path },
              tx,
            );
          }
          await saveBaseline(
            tx,
            projectId,
            manifest,
            file,
            nodeId,
            manifest.headSha!,
            manifest.sequence,
          );
          const saved = await tx
            .update(githubSyncRuns)
            .set({
              result: { ...result, applied: nextApplied },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(githubSyncRuns.id, runId),
                eq(githubSyncRuns.leaseId, leaseId),
                eq(githubSyncRuns.status, "running"),
              ),
            )
            .returning({ id: githubSyncRuns.id });
          if (!saved.length) throw new Error("Synchronization lease was lost");
        };
        if (file.nodeId && file.storageKey) {
          await withTransientFileLease(
            { projectId, nodeId: file.nodeId, userId: actorId },
            async (lease) => {
              await validateReviewedLocalFiles(projectId, {
                ...manifest,
                files: [file],
              });
              if (file.snapshotKey) {
                await applyFileRevision({
                  projectId,
                  nodeId: file.nodeId!,
                  actorUserId: actorId,
                  contentAuthorId: isRemote
                    ? authors[0]?.userId || null
                    : actorId,
                  attribution,
                  storageKey: file.snapshotKey,
                  size: file.size,
                  mimeType: file.mimeType,
                  contentHash: file.resultHash || null,
                  mode: "new_revision",
                  baseVersion: file.version,
                  baseHash: file.localHash,
                  baseStorageKey: file.storageKey!,
                  basePath: `/${file.renamedFrom || file.path}`,
                  lease,
                  accessRequirement: "write",
                  eventType: "github_file_imported",
                  eventMetadata: { operationId: runId, contributors: authors },
                  afterMutationTx: (tx) => finish(tx, file.nodeId),
                });
              } else
                await db.transaction(async (tx) => {
                  await assertProjectWriteAccessTx(tx, projectId, actorId);
                  await assertOwnedFileLease(tx, {
                    projectId,
                    nodeId: file.nodeId!,
                    userId: actorId,
                    credentials: lease,
                  });
                  const current = await tx.query.projectNodes.findFirst({
                    where: eq(projectNodes.id, file.nodeId!),
                  });
                  if (
                    !current ||
                    current.deletedAt ||
                    current.s3Key !== file.storageKey ||
                    current.path !== `/${file.path}` ||
                    current.currentVersion !== file.version
                  )
                    throw new Error("File changed after review");
                  await tx
                    .update(projectNodes)
                    .set({ deletedAt: new Date(), deletedBy: actorId })
                    .where(
                      and(
                        eq(projectNodes.id, file.nodeId!),
                        eq(projectNodes.projectId, projectId),
                      ),
                    );
                  await recordNodeEvent(
                    projectId,
                    actorId,
                    file.nodeId,
                    "github_file_deleted",
                    { operationId: runId },
                    tx,
                  );
                  await finish(tx, file.nodeId);
                });
            },
          );
        } else if (file.snapshotKey) {
          await db.transaction(async (tx) => {
            await assertProjectWriteAccessTx(tx, projectId, actorId);
            const collision = await tx.query.projectNodes.findFirst({
              where: and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.path, `/${file.path}`),
                isNull(projectNodes.taskId),
                isNull(projectNodes.deletedAt),
              ),
            });
            if (collision)
              throw new Error("An incoming file appeared after review");
            const parts = file.path.split("/");
            const parentId = await ensureIncomingParent(
              tx,
              projectId,
              file.path,
              actorId,
            );
            const [node] = await tx
              .insert(projectNodes)
              .values({
                projectId,
                parentId,
                path: `/${file.path}`,
                type: "file",
                name: parts.at(-1)!,
                createdBy: isRemote ? authors[0]?.userId || null : actorId,
                s3Key: file.snapshotKey,
                size: file.size,
                mimeType: file.mimeType,
              })
              .returning();
            if (!node) throw new Error("Unable to create incoming file");
            await tx.insert(fileVersions).values({
              nodeId: node.id,
              version: 1,
              s3Key: file.snapshotKey!,
              size: file.size,
              mimeType: file.mimeType,
              contentHash: file.resultHash,
              uploadedBy: isRemote ? authors[0]?.userId || null : actorId,
              attribution,
            });
            await recordNodeEvent(
              projectId,
              actorId,
              node.id,
              "github_file_imported",
              { operationId: runId, contributors: authors },
              tx,
            );
            await finish(tx, node.id);
          });
        } else await db.transaction((tx) => finish(tx, file.nodeId));
        result = {
          ...result,
          applied: nextApplied,
          commitSha: manifest.headSha,
        };
      }
    }
    await update({ result, stage: "Recording synchronization result" });
    await db.transaction(async (tx) => {
      await assertProjectWriteAccessTx(tx, projectId, actorId);
      const locked = await tx.execute(
        sql`SELECT id FROM github_sync_runs WHERE id=${runId} AND lease_id=${leaseId} AND status='running' FOR UPDATE`,
      );
      if (!locked.length) throw new Error("Synchronization lease was lost");
      await tx
        .update(projects)
        .set({
          githubLastSyncAt: new Date(),
          ...(manifest.mode === "direct" || manifest.direction === "pull"
            ? { githubLastCommitSha: result.commitSha }
            : {}),
        })
        .where(eq(projects.id, projectId));
      await recordNodeEvent(
        projectId,
        actorId,
        null,
        manifest.direction === "push" ? "git_push" : "git_pull",
        { operationId: runId, ...result, fileCount: manifest.files.length },
        tx,
      );

      // Automated Task Directive: Closes/Fixes #KEY transitions task to done
      if (manifest.message) {
        const directiveMatch = manifest.message.match(
          /\b(?:closes?|fix(?:es)?|resolv(?:es?))\s+#?([A-Za-z0-9_-]+)/i,
        );
        if (directiveMatch && directiveMatch[1]) {
          const rawKey = directiveMatch[1];
          const numMatch = rawKey.match(/(\d+)$/);
          if (numMatch && numMatch[1]) {
            const taskNum = parseInt(numMatch[1], 10);
            await tx
              .update(tasks)
              .set({ status: "done", updatedAt: new Date() })
              .where(
                and(
                  eq(tasks.projectId, projectId),
                  eq(tasks.taskNumber, taskNum),
                ),
              )
              .catch(() => null);
          }
        }
      }

      // Automated Ecosystem Broadcast to Project Updates
      if (manifest.direction === "push") {
        const commitShort = result.commitSha ? result.commitSha.slice(0, 7) : "";
        const updateContent = result.pullRequestUrl
          ? `Opened Pull Request #${result.pullRequestNumber || ""} on branch \`${manifest.branch}\` with ${manifest.files.length} files.`
          : `Synchronized ${manifest.files.length} ${manifest.files.length === 1 ? "file" : "files"} to \`${manifest.branch}\` on GitHub${commitShort ? ` (commit \`${commitShort}\`)` : ""}.`;

        await tx
          .insert(projectUpdates)
          .values({
            projectId,
            authorId: actorId,
            content: updateContent,
            updateType: "progress",
            visibility: "members",
            replyPolicy: "members",
            metadata: {
              source: "github_sync",
              commitSha: result.commitSha,
              pullRequestUrl: result.pullRequestUrl,
              branch: manifest.branch,
              fileCount: manifest.files.length,
            },
          })
          .catch(() => null);
      }
      if (manifest.direction === "pull")
        await tx
          .update(githubSyncConnections)
          .set({ incomingSha: null })
          .where(
            and(
              eq(githubSyncConnections.projectId, projectId),
              eq(githubSyncConnections.incomingSha, manifest.headSha!),
            ),
          );
      await tx
        .update(githubSyncRuns)
        .set({
          status: "completed",
          stage: result.pullRequestUrl
            ? "Published — pull request awaiting merge"
            : "Synchronization complete",
          result,
          credential: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.id, runId),
            eq(githubSyncRuns.leaseId, leaseId),
          ),
        );
    });
    return result;
  } catch (error) {
    const message = sanitizeGitErrorMessage(error);
    const needsReview =
      /after review|changed|expired|collid|conflict|lease was lost/i.test(
        message,
      ) && !result.pushed;
    await db
      .update(githubSyncRuns)
      .set({
        status: needsReview ? "needs_review" : "failed",
        error: message,
        stage: result.pushed
          ? "Published to GitHub; follow-up needs attention"
          : result.repositoryCreated
            ? "Repository created; publication needs attention"
            : "Synchronization needs attention",
        result,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(githubSyncRuns.id, runId), eq(githubSyncRuns.leaseId, leaseId)),
      );
    throw error;
  }
}
