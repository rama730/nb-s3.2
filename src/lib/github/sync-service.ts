import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, inArray, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  projectNodes,
  projectNodeEvents,
  fileVersions,
  profiles,
  githubSyncConnections,
  githubSyncFiles,
  githubSyncRuns,
  githubContributorIdentities,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveGithubRepoAccess } from "./auth-resolver";
import { sealGithubImportToken } from "./repo-security";
import {
  normalizeGithubBranch,
  normalizeGithubRepoUrl,
} from "./repo-validation";
import {
  requireExistingOrEmptyBranch,
  readGitHubTree,
  readGitHubBlob,
  repoApi,
  syncGithub,
  type SyncRepo,
} from "./sync-api";
import {
  contentHashes,
  detectIncomingRenames,
  classifySyncFile,
  excludedSyncPath,
  assertSafeSyncContent,
  validateSyncPath,
  SYNC_LIMITS,
  redactSyncManifest,
  type SyncManifest,
  type SyncFile,
  type SyncContributor,
  type SyncRunView,
} from "./sync-contract";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import {
  buildProjectFileKey,
  parseProjectIdFromProjectFileKey,
} from "@/lib/storage/project-file-key";

export async function requireSyncOwner(projectId: string, userId: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
  });
  if (!project || project.ownerId !== userId)
    throw new Error(
      "Only the project owner can manage GitHub synchronization.",
    );
  return project;
}
export async function resolveSyncContext(
  projectId: string,
  userId: string,
  oauthToken?: string | null,
  repositoryOverride?: string,
) {
  const project = await requireSyncOwner(projectId, userId);
  const connection = await db.query.githubSyncConnections.findFirst({
    where: eq(githubSyncConnections.projectId, projectId),
  });
  const repository =
    repositoryOverride || connection?.repository || project.githubRepoUrl;
  const metadata = project.importSource?.metadata as
    | Record<string, unknown>
    | undefined;
  const access = repository
    ? await resolveGithubRepoAccess({
        repoUrl: repository,
        oauthToken,
        sealedImportToken: metadata?.importAuth,
        preferredInstallationId: connection?.installationId,
      })
    : null;
  return {
    project,
    connection,
    repository,
    token: oauthToken || access?.token || null,
    userToken: oauthToken || null,
    access,
  };
}
export type SyncContext = Awaited<ReturnType<typeof resolveSyncContext>>;

export async function readStoredSyncContent(projectId: string, key: string) {
  if (parseProjectIdFromProjectFileKey(key) !== projectId)
    throw new Error("File content is outside this project");
  const storage = (await createAdminClient()).storage.from("project-files");
  const { data, error } = await storage.download(key);
  if (error || !data)
    throw new Error("Unable to read file content. Please retry.");
  if (data.size > SYNC_LIMITS.fileBytes)
    throw new Error("File exceeds the 10 MB sync limit");
  return Buffer.from(await data.arrayBuffer());
}

export async function readSyncContributors(
  projectId: string,
  nodeIds: string[],
) {
  if (!nodeIds.length)
    return new Map<string, Array<SyncContributor & { sequence: number }>>();
  const rows = await db
    .select({
      nodeId: projectNodeEvents.nodeId,
      actorId: projectNodeEvents.actorId,
      sequence: projectNodeEvents.sequenceNumber,
      name: profiles.fullName,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
      githubId: githubContributorIdentities.githubId,
      githubLogin: githubContributorIdentities.login,
      email: githubContributorIdentities.email,
    })
    .from(projectNodeEvents)
    .innerJoin(profiles, eq(profiles.id, projectNodeEvents.actorId))
    .leftJoin(
      githubContributorIdentities,
      eq(githubContributorIdentities.userId, profiles.id),
    )
    .where(
      and(
        eq(projectNodeEvents.projectId, projectId),
        inArray(projectNodeEvents.nodeId, nodeIds),
        eq(projectNodeEvents.type, "file_content_contributed"),
        sql`${projectNodeEvents.metadata}->>'source' = 'edge'`,
        isNull(profiles.deletedAt),
      ),
    )
    .orderBy(desc(projectNodeEvents.sequenceNumber))
    .limit(20_001);
  if (rows.length > 20_000)
    throw new Error(
      "Too much contribution history for one comparison. Select a smaller publication scope.",
    );
  const result = new Map<
    string,
    Array<SyncContributor & { sequence: number }>
  >();
  for (const row of rows) {
    if (!row.nodeId) continue;
    const authors = result.get(row.nodeId) || [];
    if (!authors.some((author) => author.userId === row.actorId))
      authors.push({
        userId: row.actorId,
        name: row.name || row.username || "Contributor",
        username: row.username,
        avatarUrl: row.avatarUrl,
        githubId: row.githubId,
        githubLogin: row.githubLogin,
        email: row.email,
        sequence: row.sequence,
        source: "edge",
      });
    result.set(row.nodeId, authors);
  }
  // Legacy local versions are evidence, imported GitHub versions are not evidence about the importer.
  const legacy = await db.execute<{
    node_id: string;
    user_id: string;
    name: string;
    username: string | null;
    avatar_url: string | null;
    github_id: number | null;
    login: string | null;
    email: string | null;
  }>(sql`
    SELECT DISTINCT version.node_id,p.id AS user_id,COALESCE(p.full_name,p.username,'Contributor') AS name,
      p.username,p.avatar_url,identity.github_id,identity.login,identity.email
    FROM file_versions version JOIN project_nodes node ON node.id=version.node_id
    JOIN profiles p ON p.id=version.uploaded_by AND p.deleted_at IS NULL
    LEFT JOIN github_contributor_identities identity ON identity.user_id=p.id
    WHERE node.project_id=${projectId} AND ${inArray(sql`node.id`, nodeIds)}
      AND node.git_blob_hash IS NULL AND version.attribution='{}'::jsonb
    LIMIT 20001
  `);
  if (legacy.length > 20000)
    throw new Error(
      "Contribution history exceeds the supported comparison limit",
    );
  for (const row of legacy) {
    const authors = result.get(row.node_id) || [];
    if (!authors.some((author) => author.userId === row.user_id))
      authors.push({
        userId: row.user_id,
        name: row.name,
        username: row.username,
        avatarUrl: row.avatar_url,
        githubId: row.github_id,
        githubLogin: row.login,
        email: row.email,
        source: "edge",
        sequence: 0,
      });
    result.set(row.node_id, authors);
  }
  return result;
}

export async function compareSync(
  ctx: SyncContext,
  input: Pick<SyncManifest, "direction" | "branch" | "mode" | "newRepository">,
): Promise<SyncManifest> {
  const branch = normalizeGithubBranch(input.branch);
  if (!branch) throw new Error("Choose a valid GitHub branch");
  const repository = input.newRepository
    ? `https://github.com/${input.newRepository.owner}/${input.newRepository.name}`
    : ctx.repository;
  if (input.newRepository && !ctx.userToken)
    throw new Error(
      "Reconnect your GitHub account to authorize repository creation",
    );
  if (input.newRepository && input.direction !== "push")
    throw new Error("A new repository can only receive an initial push");
  if (!repository || !normalizeGithubRepoUrl(repository))
    throw new Error("Choose a repository first");
  let repo: SyncRepo | null = null;
  if (!input.newRepository) {
    repo = await syncGithub<SyncRepo>(ctx.token, repoApi(repository));
    if (repo.archived) throw new Error("This repository is archived");
    if (ctx.connection && repo.id !== ctx.connection.repositoryId)
      throw new Error(
        "Repository identity changed. Reconnect and review the destination.",
      );
    if (
      input.direction === "push" &&
      (!ctx.token || repo.permissions?.push === false)
    )
      throw new Error("GitHub write access is required");
  }
  const headSha = repo
    ? await requireExistingOrEmptyBranch(ctx.token, repository, branch)
    : null;
  const [tree, rows, baselines] = await Promise.all([
    readGitHubTree(ctx.token, repository, headSha),
    db
      .select({ node: projectNodes, version: fileVersions })
      .from(projectNodes)
      .leftJoin(
        fileVersions,
        and(
          eq(fileVersions.nodeId, projectNodes.id),
          eq(fileVersions.version, projectNodes.currentVersion),
        ),
      )
      .where(
        and(
          eq(projectNodes.projectId, ctx.project.id),
          isNull(projectNodes.taskId),
          isNull(projectNodes.canonicalNodeId),
        ),
      )
      .limit(SYNC_LIMITS.comparisonFiles + 1),
    repo
      ? db
          .select()
          .from(githubSyncFiles)
          .where(
            and(
              eq(githubSyncFiles.projectId, ctx.project.id),
              eq(githubSyncFiles.repositoryId, repo.id),
              eq(githubSyncFiles.branch, branch),
            ),
          )
      : Promise.resolve([]),
  ]);
  if (
    rows.length > SYNC_LIMITS.comparisonFiles ||
    tree.length > SYNC_LIMITS.comparisonFiles
  )
    throw new Error(
      `Repository exceeds the ${SYNC_LIMITS.comparisonFiles.toLocaleString()}-entry comparison limit`,
    );
  const nodes = new Map(rows.map((row) => [row.node.id, row.node]));
  const pathFor = (id: string): string => {
    const parts: string[] = [];
    const visited = new Set<string>();
    let cursor: string | null = id;
    while (cursor) {
      if (visited.has(cursor) || visited.size >= 256)
        throw new Error("Invalid file hierarchy");
      visited.add(cursor);
      const node = nodes.get(cursor);
      if (!node) throw new Error("Missing parent folder");
      if (node.deletedAt) return "";
      parts.unshift(node.name);
      cursor = node.parentId;
    }
    return parts.join("/");
  };
  const local = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (row.node.type === "file") {
      const path = pathFor(row.node.id);
      if (path) local.set(path, row);
    }
  const remote = new Map(tree.map((entry) => [entry.path, entry]));
  const base = new Map(baselines.map((entry) => [entry.path, entry]));
  const paths = [
    ...new Set([...local.keys(), ...remote.keys(), ...base.keys()]),
  ]
    .filter((path) => !excludedSyncPath(path))
    .sort();
  if (paths.length > SYNC_LIMITS.comparisonFiles)
    throw new Error(
      `This sync supports ${SYNC_LIMITS.comparisonFiles.toLocaleString()} files per repository comparison.`,
    );
  const authorMap = await readSyncContributors(
    ctx.project.id,
    paths.flatMap((path) => {
      const id = local.get(path)?.node.id;
      return id ? [id] : [];
    }),
  );
  const files = await runWithConcurrency(
    paths,
    6,
    async (path): Promise<SyncFile> => {
      const row = local.get(path);
      const entry = remote.get(path);
      const previous = base.get(path);
      let blocked = excludedSyncPath(path);
      if (entry && !["100644", "100755"].includes(entry.mode))
        blocked = "Symbolic links and submodules require a Git client";
      const size = Math.max(Number(row?.node.size || 0), entry?.size || 0);
      if (size > SYNC_LIMITS.fileBytes)
        blocked = "File exceeds the 10 MB sync limit";
      let localHash: string | null = row?.version?.contentHash || null;
      let localBlobSha: string | null = null;
      if (row && !row.node.s3Key) blocked = "File content is not available";
      if (row?.node.s3Key && !blocked) {
        if (
          localHash &&
          previous?.localHash === localHash &&
          previous.localBlobSha
        )
          localBlobSha = previous.localBlobSha;
        else {
          const content = await readStoredSyncContent(
            ctx.project.id,
            row.node.s3Key,
          );
          const hashes = contentHashes(content);
          localHash = hashes.hash;
          localBlobSha = hashes.blobSha;
          if (input.direction === "push") {
            try {
              assertSafeSyncContent(content);
            } catch (error) {
              blocked = (error as Error).message;
            }
          }
        }
      }
      const contributors = (authorMap.get(row?.node.id || "") || []).filter(
        (author) => !previous || author.sequence > previous.sequence,
      );
      return {
        path,
        nodeId: row?.node.id || previous?.nodeId || null,
        version: row?.node.currentVersion ?? null,
        storageKey: row?.node.s3Key || null,
        localHash,
        localBlobSha,
        remoteSha: entry?.sha || null,
        baseSha: previous?.blobSha ?? null,
        baseCommit: previous?.commitSha || null,
        baseSequence: previous?.sequence || 0,
        size,
        mimeType: row?.node.mimeType || "application/octet-stream",
        mode: entry?.mode || "100644",
        blocked,
        contributors,
        change: classifySyncFile(
          input.direction,
          localBlobSha,
          entry?.sha || null,
          previous ? previous.blobSha : undefined,
        ),
      };
    },
  );
  const latest = await requireSyncOwner(ctx.project.id, ctx.project.ownerId);
  if (latest.currentSequenceNumber !== ctx.project.currentSequenceNumber)
    throw new Error("Project files changed during comparison. Compare again.");
  // Matching content is authoritative baseline evidence, including a pull request merged outside Edge.
  const matching = files.filter(
    (file) =>
      !file.blocked &&
      file.localBlobSha &&
      file.localBlobSha === file.remoteSha,
  );
  if (repo && headSha && matching.length)
    await db.transaction(async (tx) => {
      const locked = await tx.execute<{ current_sequence_number: number }>(
        sql`SELECT current_sequence_number FROM projects WHERE id=${ctx.project.id} FOR UPDATE`,
      );
      if (
        Number(locked[0]?.current_sequence_number) !==
        latest.currentSequenceNumber
      )
        throw new Error("Files changed during comparison. Compare again.");
      await tx
        .insert(githubSyncFiles)
        .values(
          matching.map((file) => ({
            projectId: ctx.project.id,
            repositoryId: repo!.id,
            branch,
            path: file.path,
            nodeId: file.nodeId,
            blobSha: file.remoteSha,
            localHash: file.localHash,
            localBlobSha: file.localBlobSha,
            commitSha: headSha,
            sequence: latest.currentSequenceNumber,
          })),
        )
        .onConflictDoUpdate({
          target: [
            githubSyncFiles.projectId,
            githubSyncFiles.repositoryId,
            githubSyncFiles.branch,
            githubSyncFiles.path,
          ],
          set: {
            nodeId: sql`excluded.node_id`,
            blobSha: sql`excluded.blob_sha`,
            localHash: sql`excluded.local_hash`,
            localBlobSha: sql`excluded.local_blob_sha`,
            commitSha: sql`excluded.commit_sha`,
            sequence: sql`excluded.sequence`,
          },
        });
    });
  return {
    repository,
    repositoryId: repo?.id || null,
    branch,
    headSha,
    connectionVersion: ctx.connection?.version || 0,
    sequence: latest.currentSequenceNumber,
    direction: input.direction,
    mode: headSha ? input.mode : "direct",
    message: "",
    files: input.direction === "pull" ? detectIncomingRenames(files) : files,
    ...(input.newRepository ? { newRepository: input.newRepository } : {}),
  };
}

export async function createSyncReview(
  ctx: SyncContext,
  manifest: SyncManifest,
  choices: Array<{
    path: string;
    resolution?: "edge" | "github" | "merge";
    content?: string;
  }>,
  message: string,
) {
  if (!choices.length) throw new Error("Select at least one file");
  if (choices.length > SYNC_LIMITS.operationFiles)
    throw new Error(
      `Select no more than ${SYNC_LIMITS.operationFiles.toLocaleString()} files per operation`,
    );
  if (new Set(choices.map((choice) => choice.path)).size !== choices.length)
    throw new Error("Duplicate file selection");
  const selected: SyncFile[] = [];
  const manifestFiles = new Map(
    manifest.files.map((file) => [file.path, file] as const),
  );
  let total = 0;
  const id = randomUUID();
  const credential = ctx.token
    ? sealGithubImportToken(ctx.token, 60 * 60_000)
    : null;
  if (ctx.token && !credential && ctx.access?.source !== "app")
    throw new Error(
      "Configure GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY or a GitHub App before queuing sync",
    );
  const storage = (await createAdminClient()).storage.from("project-files");
  const uploaded: string[] = [];
  const resolver = choices.some((choice) => choice.resolution === "merge")
    ? await db.query.profiles.findFirst({
        where: eq(profiles.id, ctx.project.ownerId),
      })
    : null;
  const resolverIdentity = resolver
    ? await db.query.githubContributorIdentities.findFirst({
        where: eq(githubContributorIdentities.userId, resolver.id),
      })
    : null;
  try {
    // Bound memory to at most six per-file buffers while avoiding a serial
    // download/upload round trip for every selected path.
    const batchSize = 6;
    for (let offset = 0; offset < choices.length; offset += batchSize) {
      const batch = choices.slice(offset, offset + batchSize);
      const prepared = await Promise.all(
        batch.map(async (choice, batchIndex) => {
          const file = manifestFiles.get(choice.path);
          if (!file || file.blocked || file.change === "unchanged")
            throw new Error(`Cannot synchronize ${choice.path}`);
          if (file.change === "conflict" && !choice.resolution)
            throw new Error(`Resolve the conflict in ${choice.path}`);
          const source =
            choice.resolution ||
            (manifest.direction === "push" ? "edge" : "github");
          if (
            choice.resolution ===
            (manifest.direction === "push" ? "github" : "edge")
          )
            throw new Error(
              `Keeping the destination makes no change to ${file.path}. Unselect it, or use the opposite sync direction to update the other copy.`,
            );
          let content: Buffer | null = null;
          if (source === "merge") {
            if (choice.content === undefined || choice.content.includes("\0"))
              throw new Error("Provide resolved text content");
            content = Buffer.from(choice.content, "utf8");
          } else if (source === "edge" && file.storageKey)
            content = await readStoredSyncContent(
              ctx.project.id,
              file.storageKey,
            );
          else if (source === "github" && file.remoteSha)
            content = await readGitHubBlob(
              ctx.token,
              manifest.repository,
              file.remoteSha,
            );
          const item = { ...file, resolution: choice.resolution };
          if (
            source === "merge" &&
            resolver &&
            !item.contributors.some((author) => author.userId === resolver.id)
          ) {
            item.contributors = [
              ...item.contributors,
              {
                userId: resolver.id,
                name: resolver.fullName || resolver.username || "Contributor",
                username: resolver.username,
                avatarUrl: resolver.avatarUrl,
                githubId: resolverIdentity?.githubId || null,
                githubLogin: resolverIdentity?.login || null,
                email: resolverIdentity?.email || null,
                source: "edge",
              },
            ];
          }
          if (content) {
            assertSafeSyncContent(content);
            const { hash, blobSha } = contentHashes(content);
            if (source === "edge" && hash !== file.localHash)
              throw new Error(
                "File changed while preparing the review. Compare again.",
              );
            item.snapshotKey = buildProjectFileKey(
              ctx.project.id,
              `sync-snapshots/${id}/${offset + batchIndex}`,
            );
            item.resultHash = hash;
            item.resultBlobSha = blobSha;
            item.size = content.length;
          }
          return { item, content };
        }),
      );
      total += prepared.reduce(
        (sum, item) => sum + (item.content?.length || 0),
        0,
      );
      if (total > SYNC_LIMITS.operationBytes)
        throw new Error(
          `Selected files exceed the ${Math.floor(SYNC_LIMITS.operationBytes / (1024 * 1024))} MB operation limit`,
        );
      const uploads = await Promise.allSettled(
        prepared.map(async ({ item, content }) => {
          if (!content || !item.snapshotKey) return null;
          const { error } = await storage.upload(item.snapshotKey, content, {
            contentType: item.mimeType,
            upsert: false,
          });
          if (error)
            throw new Error("Unable to retain the reviewed file snapshot");
          return item.snapshotKey;
        }),
      );
      for (const upload of uploads)
        if (upload.status === "fulfilled" && upload.value)
          uploaded.push(upload.value);
      const failed = uploads.find((upload) => upload.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      selected.push(...prepared.map(({ item }) => item));
    }
    const [run] = await db
      .insert(githubSyncRuns)
      .values({
        id,
        projectId: ctx.project.id,
        actorId: ctx.project.ownerId,
        manifest: { ...manifest, message, files: selected },
        credential,
      })
      .returning();
    if (!run) throw new Error("Failed to persist sync review");
    return syncRunView(run);
  } catch (error) {
    const persisted = await db.query.githubSyncRuns.findFirst({
      where: eq(githubSyncRuns.id, id),
      columns: { id: true },
    });
    if (!persisted && uploaded.length) await storage.remove(uploaded);
    throw error;
  }
}

export async function cleanupReviewedSyncSnapshots() {
  const runs = await db
    .select()
    .from(githubSyncRuns)
    .where(
      and(
        inArray(githubSyncRuns.status, ["completed", "cancelled"]),
        sql`${githubSyncRuns.updatedAt} < now() - interval '7 days'`,
        sql`COALESCE(${githubSyncRuns.result}->>'snapshotsCleaned','false') <> 'true'`,
      ),
    )
    .limit(25);
  const storage = (await createAdminClient()).storage.from("project-files");
  for (const run of runs) {
    const keys = run.manifest.files.flatMap((file) =>
      file.snapshotKey ? [file.snapshotKey] : [],
    );
    if (keys.length) {
      const versions = await db
        .select({ key: fileVersions.s3Key })
        .from(fileVersions)
        .where(inArray(fileVersions.s3Key, keys));
      const nodes = await db
        .select({ key: projectNodes.s3Key })
        .from(projectNodes)
        .where(inArray(projectNodes.s3Key, keys));
      const retained = new Set([...versions, ...nodes].map((row) => row.key));
      const removable = keys.filter(
        (key) =>
          !retained.has(key) &&
          key.startsWith(`${run.projectId}/sync-snapshots/${run.id}/`),
      );
      if (removable.length) {
        const { error } = await storage.remove(removable);
        if (error) throw new Error("Snapshot cleanup could not finish");
      }
    }
    await db
      .update(githubSyncRuns)
      .set({ result: { ...run.result, snapshotsCleaned: true } })
      .where(eq(githubSyncRuns.id, run.id));
  }
  return runs.length;
}
export function syncRunView(
  run: typeof githubSyncRuns.$inferSelect,
): SyncRunView {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    direction: run.manifest.direction,
    manifest: redactSyncManifest(run.manifest),
    result: run.result,
  };
}

export async function validateReviewedLocalFiles(
  projectId: string,
  manifest: SyncManifest,
  applied: string[] = [],
) {
  for (const file of manifest.files) {
    if (applied.includes(file.path)) continue;
    validateSyncPath(file.path);
    if (!file.nodeId || !file.storageKey) {
      const collision = await db.query.projectNodes.findFirst({
        where: and(
          eq(projectNodes.projectId, projectId),
          eq(projectNodes.path, `/${file.path}`),
          isNull(projectNodes.deletedAt),
          isNull(projectNodes.taskId),
        ),
      });
      if (collision)
        throw new Error(`File appeared after review: ${file.path}`);
      continue;
    }
    const node = await db.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.id, file.nodeId),
        eq(projectNodes.projectId, projectId),
        isNull(projectNodes.deletedAt),
      ),
    });
    if (
      !node ||
      node.currentVersion !== file.version ||
      node.s3Key !== file.storageKey ||
      node.path.replace(/^\//, "") !== (file.renamedFrom || file.path)
    )
      throw new Error(`File changed after review: ${file.path}`);
    if (
      contentHashes(await readStoredSyncContent(projectId, node.s3Key!))
        .hash !== file.localHash
    )
      throw new Error(`Content changed after review: ${file.path}`);
  }
}
