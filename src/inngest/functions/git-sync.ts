import { inngest } from "../client";
import simpleGit from "simple-git";
import { db } from "@/lib/db";
import { projects, projectNodes, projectNodeEvents, projectNodeLocks, projectGitDeltas, projectNodeConflicts, profiles } from "@/lib/db/schema";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/server";
import { tmpdir } from "os";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat, rename } from "fs/promises";
import { join, relative, dirname } from "path";
import { pipeline } from "stream/promises";
import { createWriteStream, createReadStream } from "fs";
import { Readable } from "stream";
import { createHash, randomUUID } from "crypto";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { appendSafePathSegment, resolvePathUnderRoot } from "@/lib/security/path-safety";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { normalizeGithubBranch } from "@/lib/github/repo-validation";
import { assertRepositoryWithinBudgets, GITHUB_WORKER_BUDGETS, withTenantSyncLock } from "@/lib/github/worker-guard";
import { withGitCredentialEnv } from "@/lib/github/git-auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { logger } from "@/lib/logger";
import { verifySignedJobRequestToken } from "@/lib/security/job-request";
import { deleteExpiredFileLeases } from "@/lib/files/file-lock-service";
import { cleanupExpiredUploadIntents } from "@/lib/upload/upload-intents";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = (() => {
    const v = Number(process.env.GITHUB_IMPORT_CLONE_TIMEOUT_MS || 120000);
    return Number.isFinite(v) && v >= 30_000 && v <= 120_000 ? Math.floor(v) : 120000;
})();
const LOCK_NAMESPACE = "project-git-sync";

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function hasNodeErrorCode(error: unknown, code: string) {
    return !!error && typeof error === "object" && "code" in error
        && (error as { code?: unknown }).code === code;
}

async function cleanupTemporaryDirectory(tempDir: string, operation: "push" | "pull") {
    try {
        await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
        logger.warn("github.sync.temp_cleanup_failed", {
            module: "git-sync",
            action: operation,
            path: tempDir,
            error: errorMessage(error),
        });
    }
}

async function markGitDeltasFailed(deltaIds: string[], error: unknown) {
    if (deltaIds.length === 0) return;
    await db
        .update(projectGitDeltas)
        .set({
            status: "failed",
            processingError: errorMessage(error).slice(0, 2000),
            processedAt: new Date(),
        })
        .where(inArray(projectGitDeltas.id, deltaIds));
}

function resolveQueueAgeMs(event: { ts?: string | number | null }) {
    const raw = event.ts;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.max(0, Date.now() - raw);
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Date.now() - parsed);
        }
    }
    return null;
}

function computeFileHash(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

async function* walkDir(dir: string, base: string = dir): AsyncGenerator<string> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === ".git") continue;
        const full = appendSafePathSegment(dir, entry.name, "repository entry");
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            yield* walkDir(full, base);
        } else {
            yield relative(base, full);
        }
    }
}

function buildNodePath(
    nodeId: string,
    nodesById: Map<string, { name: string; parentId: string | null }>,
): string {
    const parts: string[] = [];
    let current: string | null = nodeId;
    while (current) {
        const node = nodesById.get(current);
        if (!node) break;
        parts.unshift(node.name);
        current = node.parentId;
    }
    return parts.join("/");
}

async function withProjectSyncLock<T>(projectId: string, task: () => Promise<T>): Promise<{ skipped: boolean; value: T | null }> {
    const lockResult = await db.execute<{ locked: boolean }>(sql`
        SELECT pg_try_advisory_lock(
            hashtext(${LOCK_NAMESPACE}),
            hashtext(CAST(${projectId} AS text))
        ) AS locked
    `);
    const lockRow = Array.from(lockResult)[0];
    const lockAcquired = !!lockRow?.locked;
    if (!lockAcquired) {
        return { skipped: true, value: null };
    }

    try {
        return { skipped: false, value: await task() };
    } finally {
        await db.execute(sql`
            SELECT pg_advisory_unlock(
                hashtext(${LOCK_NAMESPACE}),
                hashtext(CAST(${projectId} AS text))
            )
        `);
    }
}

async function cloneRepository(repoUrl: string, tempDir: string, branch: string, accessToken?: string | null) {
    const normalizedBranch = normalizeGithubBranch(branch);
    if (!normalizedBranch) {
        throw new Error("Invalid GitHub branch name");
    }
    const cloneArgs = [
        "clone",
        repoUrl,
        tempDir,
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        normalizedBranch,
    ];
    await withGitCredentialEnv(accessToken, async (gitEnv) =>
        execFileAsync("git", cloneArgs, {
            timeout: GIT_COMMAND_TIMEOUT_MS,
            env: gitEnv,
            maxBuffer: 4 * 1024 * 1024,
        })
    );
}

async function pushRepository(tempDir: string, branch: string, accessToken?: string | null) {
    const normalizedBranch = normalizeGithubBranch(branch);
    if (!normalizedBranch) {
        throw new Error("Invalid GitHub branch name");
    }
    const pushArgs = ["-C", tempDir, "push", "origin", normalizedBranch];
    await withGitCredentialEnv(accessToken, async (gitEnv) =>
        execFileAsync("git", pushArgs, {
            timeout: GIT_COMMAND_TIMEOUT_MS,
            env: gitEnv,
            maxBuffer: 4 * 1024 * 1024,
        })
    );
}

async function readLatestCommitSha(tempDir: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync("git", ["-C", tempDir, "rev-parse", "HEAD"], {
            timeout: 15_000,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: "0",
            },
            maxBuffer: 512 * 1024,
        });
        const sha = String(stdout || "").trim();
        return sha || null;
    } catch (error) {
        logger.warn("github.sync.commit_sha_unavailable", {
            module: "git-sync",
            path: tempDir,
            error: errorMessage(error),
        });
        return null;
    }
}

export const gitPush = inngest.createFunction(
    { id: "git-push", retries: 1, concurrency: 4 },
    { event: "git/push" },
    async ({ event, step }) => {
        const { projectId, commitMessage, userId, jobSignature } = event.data;

        const requestVerification = verifySignedJobRequestToken(jobSignature, {
            kind: "git/push",
            actorId: userId,
            subjectId: projectId,
        });
        if (!requestVerification.ok) {
            throw new Error("Invalid git push job request");
        }

        logger.metric("github.sync.push.start", {
            projectId,
            userId,
            commitMessage,
            queueAgeMs: resolveQueueAgeMs(event as { ts?: string | number | null }),
        });

        const result = await step.run("push-to-github", async () => {
            const [project] = await db
                .select({
                    githubRepoUrl: projects.githubRepoUrl,
                    githubDefaultBranch: projects.githubDefaultBranch,
                    importSource: projects.importSource,
                })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!project?.githubRepoUrl) {
                throw new Error("No GitHub repository connected");
            }
            const eventData = event.data as any;
            const targetBranch = eventData.targetBranch || eventData.branch || (project.githubDefaultBranch || "main").trim() || "main";
            const sourceMetadata = ((project.importSource as Record<string, unknown> | null)?.metadata || {}) as Record<string, unknown>;
            const preferredInstallationIdRaw = sourceMetadata.githubInstallationId;
            const preferredInstallationId =
                typeof preferredInstallationIdRaw === "number" || typeof preferredInstallationIdRaw === "string"
                    ? preferredInstallationIdRaw
                    : null;
            const access = await resolveGithubRepoAccess({
                repoUrl: project.githubRepoUrl,
                preferredInstallationId,
                sealedImportToken: sourceMetadata.importAuth,
            });
            // Claim pending deltas transactionally
            const claimedDeltas = await db.transaction(async (tx) => {
                await tx.execute(sql`SELECT 1 FROM projects WHERE id = ${projectId} FOR UPDATE`);

                const deltas = await tx
                    .select()
                    .from(projectGitDeltas)
                    .where(
                        and(
                            eq(projectGitDeltas.projectId, projectId),
                            eq(projectGitDeltas.targetBranch, targetBranch),
                            inArray(projectGitDeltas.status, ['pending', 'failed'])
                        )
                    )
                    .orderBy(projectGitDeltas.sequenceNumber, projectGitDeltas.deltaOrder);

                if (deltas.length === 0) return [];

                const deltaIds = deltas.map((d) => d.id);
                await tx
                    .update(projectGitDeltas)
                    .set({
                        status: 'processing',
                        processedAt: new Date(),
                    })
                    .where(inArray(projectGitDeltas.id, deltaIds));

                return deltas;
            });

            if (claimedDeltas.length === 0) {
                logger.metric("github.sync.push.skipped", {
                    projectId,
                    reason: "no_pending_deltas",
                });
                return { success: true, skipped: "no_pending_deltas" as const };
            }

            try {
            const tenantLockedRun = await withTenantSyncLock(userId, async () => withProjectSyncLock(projectId, async () => {
                const cacheDir = `/tmp/nb-bare-cache/${projectId}`;
                await mkdir("/tmp/nb-bare-cache", { recursive: true });

                let cacheExists = false;
                try {
                    const statResult = await stat(cacheDir);
                    if (statResult.isDirectory()) {
                        cacheExists = true;
                    }
                } catch (error) {
                    if (!hasNodeErrorCode(error, "ENOENT")) throw error;
                }

                if (!cacheExists) {
                    await withGitCredentialEnv(access.token, async (gitEnv) => {
                        await execFileAsync("git", ["clone", "--bare", project.githubRepoUrl!, cacheDir], {
                            env: gitEnv,
                            timeout: GIT_COMMAND_TIMEOUT_MS,
                        });
                    });
                } else {
                    await withGitCredentialEnv(access.token, async (gitEnv) => {
                        await execFileAsync("git", ["-C", cacheDir, "fetch", "origin", `${targetBranch}:${targetBranch}`], {
                            env: gitEnv,
                            timeout: GIT_COMMAND_TIMEOUT_MS,
                        }).catch(async () => {
                            await execFileAsync("git", ["-C", cacheDir, "fetch", "origin"], {
                                env: gitEnv,
                                timeout: GIT_COMMAND_TIMEOUT_MS,
                            });
                        });
                    });
                }

                const tempDir = await mkdtemp(join(tmpdir(), "nb-git-push-"));

                try {
                    await execFileAsync("git", ["clone", cacheDir, tempDir]);
                    const repoGit = simpleGit(tempDir);
                    await execFileAsync("git", ["-C", tempDir, "checkout", "-B", targetBranch]);

                    const adminClient = await createAdminClient();

                    for (const delta of claimedDeltas) {
                        const targetPath = resolvePathUnderRoot(tempDir, delta.path, "delta path");
                        if (delta.action === "add" || delta.action === "modify") {
                            if (!delta.s3Key) {
                                throw new Error(`Missing s3Key for delta: ${delta.id}`);
                            }
                            await mkdir(dirname(targetPath), { recursive: true });
                            const { data, error } = await adminClient.storage
                                .from("project-files")
                                .download(delta.s3Key);
                            if (error || !data) {
                                throw new Error(`Failed to download file content from S3: ${error?.message || "Empty content"}`);
                            }
                            const contentBuffer = Buffer.from(await data.arrayBuffer());
                            await writeFile(targetPath, contentBuffer);
                        } else if (delta.action === "rename") {
                            if (!delta.oldPath) {
                                throw new Error(`Missing oldPath for rename delta: ${delta.id}`);
                            }
                            const oldPath = resolvePathUnderRoot(tempDir, delta.oldPath, "delta oldPath");
                            await mkdir(dirname(targetPath), { recursive: true });
                            try {
                                await rename(oldPath, targetPath);
                            } catch (error) {
                                throw new Error(
                                    `Failed to apply rename delta ${delta.id}: ${errorMessage(error)}`,
                                    { cause: error },
                                );
                            }
                        } else if (delta.action === "delete") {
                            await rm(targetPath, { force: true });
                        }
                    }

                    const [profile] = await db
                        .select({ username: profiles.username })
                        .from(profiles)
                        .where(eq(profiles.id, userId))
                        .limit(1);
                    const username = profile?.username || "collaborator";
                    await repoGit.addConfig("user.name", username);
                    await repoGit.addConfig("user.email", `${username}@users.noreply.nb.app`);

                    await repoGit.add(".");
                    const status = await repoGit.status();
                    if (status.files.length === 0) {
                        // Mark claimed deltas processed since no changes exist in commit
                        const deltaIds = claimedDeltas.map((d) => d.id);
                        await db
                            .update(projectGitDeltas)
                            .set({
                                status: 'processed',
                                processedAt: new Date(),
                            })
                            .where(inArray(projectGitDeltas.id, deltaIds));

                        await db
                            .update(projects)
                            .set({
                                githubLastSyncAt: new Date(),
                            })
                            .where(eq(projects.id, projectId));
                        
                        return { success: true, skipped: "no_changes" as const };
                    }

                    await repoGit.commit(commitMessage || "Update from NB workspace");

                    await withGitCredentialEnv(access.token, async (gitEnv) => {
                        await execFileAsync("git", ["-C", tempDir, "fetch", "origin", targetBranch], {
                            env: gitEnv,
                            timeout: GIT_COMMAND_TIMEOUT_MS,
                        });
                    });

                    let hasConflicts = false;
                    try {
                        await execFileAsync("git", ["-C", tempDir, "rebase", `origin/${targetBranch}`], {
                            timeout: GIT_COMMAND_TIMEOUT_MS,
                        });
                    } catch (rebaseError: any) {
                        hasConflicts = true;
                        const { stdout: conflictFilesStr } = await execFileAsync("git", ["-C", tempDir, "diff", "--name-only", "--diff-filter=U"]);
                        const conflictFiles = conflictFilesStr.split(/\r?\n/).filter(Boolean);

                        for (const filePath of conflictFiles) {
                            const fullPath = resolvePathUnderRoot(tempDir, filePath, "conflict file");
                            let mergedContent = "";
                            try {
                                mergedContent = await readFile(fullPath, "utf8");
                            } catch (error) {
                                logger.warn("github.sync.conflict_merged_read_failed", {
                                    module: "git-sync",
                                    projectId,
                                    path: filePath,
                                    error: errorMessage(error),
                                });
                            }

                            let canonicalContent = "";
                            let incomingContent = "";
                            try {
                                const { stdout: ours } = await execFileAsync("git", ["-C", tempDir, "show", `:2:${filePath}`]);
                                canonicalContent = ours;
                            } catch (error) {
                                logger.warn("github.sync.conflict_canonical_read_failed", {
                                    module: "git-sync",
                                    projectId,
                                    path: filePath,
                                    error: errorMessage(error),
                                });
                            }
                            try {
                                const { stdout: theirs } = await execFileAsync("git", ["-C", tempDir, "show", `:3:${filePath}`]);
                                incomingContent = theirs;
                            } catch (error) {
                                logger.warn("github.sync.conflict_incoming_read_failed", {
                                    module: "git-sync",
                                    projectId,
                                    path: filePath,
                                    error: errorMessage(error),
                                });
                            }

                            const nodePath = `/${filePath}`;
                            const node = await db.query.projectNodes.findFirst({
                                where: and(
                                    eq(projectNodes.projectId, projectId),
                                    eq(projectNodes.path, nodePath),
                                    isNull(projectNodes.deletedAt)
                                )
                            });

                            if (node) {
                                await db.insert(projectNodeConflicts).values({
                                    projectId,
                                    nodeId: node.id,
                                    taskId: claimedDeltas[0]?.taskId || null,
                                    gitBranch: targetBranch,
                                    canonicalContent,
                                    incomingContent,
                                    mergedContent,
                                    conflictStatus: 'unresolved',
                                    createdAt: new Date(),
                                });
                            }
                        }

                        try {
                            await execFileAsync("git", ["-C", tempDir, "rebase", "--abort"]);
                        } catch (error) {
                            logger.warn("github.sync.rebase_abort_failed", {
                                module: "git-sync",
                                projectId,
                                error: errorMessage(error),
                            });
                        }
                    }

                    if (hasConflicts) {
                        const deltaIds = claimedDeltas.map((d) => d.id);
                        await db
                            .update(projectGitDeltas)
                            .set({
                                status: 'conflict',
                                processingError: 'Rebase conflict',
                                processedAt: new Date(),
                            })
                            .where(inArray(projectGitDeltas.id, deltaIds));

                        return { success: false, conflict: true };
                    }

                    await withGitCredentialEnv(access.token, async (gitEnv) => {
                        await execFileAsync("git", ["-C", tempDir, "push", "origin", targetBranch], {
                            env: gitEnv,
                            timeout: GIT_COMMAND_TIMEOUT_MS,
                        });
                    });

                    const latestSha = await readLatestCommitSha(tempDir);

                    // Update bare cache
                    await withGitCredentialEnv(access.token, async (gitEnv) => {
                        await execFileAsync("git", ["-C", cacheDir, "fetch", "origin", `${targetBranch}:${targetBranch}`], {
                            env: gitEnv,
                            timeout: GIT_COMMAND_TIMEOUT_MS,
                        }).catch((error) => {
                            logger.warn("github.sync.cache_refresh_failed", {
                                module: "git-sync",
                                projectId,
                                error: errorMessage(error),
                            });
                        });
                    });

                    // Mark deltas as processed
                    const deltaIds = claimedDeltas.map((d) => d.id);
                    await db
                        .update(projectGitDeltas)
                        .set({
                            status: 'processed',
                            processedCommitSha: latestSha,
                            processedAt: new Date(),
                        })
                        .where(inArray(projectGitDeltas.id, deltaIds));

                    // Update projectNodes to git_synced
                    const nodeIdsToUpdate = claimedDeltas.map((d) => d.nodeId).filter((id): id is string => !!id);
                    if (nodeIdsToUpdate.length > 0) {
                        await db
                            .update(projectNodes)
                            .set({
                                syncStatus: 'merged',
                                lastSyncedCommitSha: latestSha,
                                updatedAt: new Date(),
                            })
                            .where(inArray(projectNodes.id, nodeIdsToUpdate));
                    }

                    await db
                        .update(projects)
                        .set({
                            githubLastSyncAt: new Date(),
                            githubLastCommitSha: latestSha,
                        })
                        .where(eq(projects.id, projectId));

                    await db.insert(projectNodeEvents).values({
                        projectId,
                        actorId: userId,
                        type: "git_push",
                        metadata: {
                            commitMessage,
                            commitSha: latestSha,
                            fileCount: claimedDeltas.length,
                            authSource: access.source,
                            installationId: access.installationId,
                        },
                    });

                    logger.metric("github.sync.push.completed", {
                        projectId,
                        commitSha: latestSha,
                        authSource: access.source,
                        installationId: access.installationId,
                    });

                    return { success: true, commitSha: latestSha };
                } finally {
                    await cleanupTemporaryDirectory(tempDir, "push");
                }
            }));

            if (tenantLockedRun.skipped) {
                // Return deltas back to pending
                const deltaIds = claimedDeltas.map((d) => d.id);
                await db
                    .update(projectGitDeltas)
                    .set({ status: 'pending' })
                    .where(inArray(projectGitDeltas.id, deltaIds));

                logger.metric("github.sync.push.skipped", {
                    projectId,
                    reason: "tenant-concurrency",
                });
                return { success: true, skipped: "tenant_in_progress" as const };
            }
            if (tenantLockedRun.value?.skipped) {
                // Return deltas back to pending
                const deltaIds = claimedDeltas.map((d) => d.id);
                await db
                    .update(projectGitDeltas)
                    .set({ status: 'pending' })
                    .where(inArray(projectGitDeltas.id, deltaIds));

                logger.metric("github.sync.push.skipped", {
                    projectId,
                    reason: "lock-in-progress",
                });
                return { success: true, skipped: "in_progress" as const };
            }
            return tenantLockedRun.value?.value;
            } catch (error) {
                await markGitDeltasFailed(claimedDeltas.map((delta) => delta.id), error);
                logger.error("github.sync.push.failed", {
                    module: "git-sync",
                    projectId,
                    error: errorMessage(error),
                });
                throw error;
            }
        });

        return result;
    },
);

export const gitPull = inngest.createFunction(
    { id: "git-pull", retries: 1, concurrency: 4 },
    { event: "git/pull" },
    async ({ event, step }) => {
        const { projectId, userId, deliveryId, jobSignature } = event.data;

        const requestVerification = verifySignedJobRequestToken(jobSignature, {
            kind: "git/pull",
            actorId: userId,
            subjectId: projectId,
        });
        if (!requestVerification.ok) {
            throw new Error("Invalid git pull job request");
        }

        logger.metric("github.sync.pull.start", {
            projectId,
            userId,
            deliveryId: deliveryId || null,
            queueAgeMs: resolveQueueAgeMs(event as { ts?: string | number | null }),
        });

        await step.run("pull-from-github", async () => {
            const activeLease = await db.query.projectNodeLocks.findFirst({
                where: and(
                    eq(projectNodeLocks.projectId, projectId),
                    sql`${projectNodeLocks.expiresAt} > now()`,
                ),
                columns: { nodeId: true, expiresAt: true },
            });
            if (activeLease) {
                throw new Error(
                    `Git pull deferred because a collaborator is editing a file until ${activeLease.expiresAt.toISOString()}`,
                );
            }
            const [project] = await db
                .select({
                    githubRepoUrl: projects.githubRepoUrl,
                    githubDefaultBranch: projects.githubDefaultBranch,
                    importSource: projects.importSource,
                })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!project?.githubRepoUrl) {
                throw new Error("No GitHub repository connected");
            }

            const branch = (project.githubDefaultBranch || "main").trim() || "main";
            const sourceMetadata = ((project.importSource as Record<string, unknown> | null)?.metadata || {}) as Record<string, unknown>;
            const preferredInstallationIdRaw = sourceMetadata.githubInstallationId;
            const preferredInstallationId =
                typeof preferredInstallationIdRaw === "number" || typeof preferredInstallationIdRaw === "string"
                    ? preferredInstallationIdRaw
                    : null;
            const access = await resolveGithubRepoAccess({
                repoUrl: project.githubRepoUrl,
                preferredInstallationId,
                sealedImportToken: sourceMetadata.importAuth,
            });
            const useAnonymousAccess = (event.data as Record<string, unknown>).anonymous === true;

            const tenantLockedRun = await withTenantSyncLock(userId, async () => withProjectSyncLock(projectId, async () => {
                const tempDir = await mkdtemp(join(tmpdir(), "nb-git-pull-"));

                try {
                    await cloneRepository(
                        project.githubRepoUrl!,
                        tempDir,
                        branch,
                        useAnonymousAccess ? null : access.token,
                    );
                    assertRepositoryWithinBudgets(tempDir, { job: "git pull", projectId });

                    const repoFiles: string[] = [];
                    for await (const file of walkDir(tempDir)) {
                        repoFiles.push(file);
                    }

                    const existingNodes = await db
                        .select({
                            id: projectNodes.id,
                            name: projectNodes.name,
                            parentId: projectNodes.parentId,
                            type: projectNodes.type,
                            s3Key: projectNodes.s3Key,
                            gitHash: projectNodes.gitHash,
                        })
                        .from(projectNodes)
                        .where(
                            and(
                                eq(projectNodes.projectId, projectId),
                                isNull(projectNodes.deletedAt),
                            ),
                        );

                    const nodesById = new Map(
                        existingNodes.map((n) => [
                            n.id,
                            { name: n.name, parentId: n.parentId },
                        ]),
                    );
                    const nodeByPath = new Map<string, (typeof existingNodes)[number]>();
                    for (const node of existingNodes) {
                        const path = buildNodePath(node.id, nodesById);
                        nodeByPath.set(path, node);
                    }

                    const adminClient = await createAdminClient();
                    const seenPaths = new Set<string>();
                    const folderCache = new Map<string, string>();

                    async function ensureFolder(folderPath: string): Promise<string | null> {
                        if (!folderPath || folderPath === ".") return null;

                        const cached = folderCache.get(folderPath);
                        if (cached) return cached;

                        const parentPath = dirname(folderPath);
                        const parentIdResolved =
                            parentPath === "." ? null : await ensureFolder(parentPath);

                        const existingFolder = nodeByPath.get(folderPath);
                        if (existingFolder && existingFolder.type === "folder") {
                            folderCache.set(folderPath, existingFolder.id);
                            return existingFolder.id;
                        }

                        const folderName =
                            folderPath.split("/").pop() ?? folderPath;
                        const [created] = await db
                            .insert(projectNodes)
                            .values({
                                projectId,
                                parentId: parentIdResolved,
                                type: "folder",
                                name: folderName,
                                createdBy: userId,
                            })
                            .returning({ id: projectNodes.id });

                        if (!created) {
                            throw new Error("Failed to create folder node");
                        }
                        folderCache.set(folderPath, created.id);
                        return created.id;
                    }

                    let newCount = 0;
                    let updatedCount = 0;
                    let deletedCount = 0;
                    let failedUploads = 0;

                    const directoryPaths = Array.from(new Set(
                        repoFiles.map((filePath) => dirname(filePath)).filter((path) => path !== "."),
                    )).sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
                    for (const directoryPath of directoryPaths) {
                        await ensureFolder(directoryPath);
                    }

                    const uploadResults = await runWithConcurrency(
                        repoFiles,
                        GITHUB_WORKER_BUDGETS.applyConcurrency,
                        async (filePath) => {
                            seenPaths.add(filePath);
                            const fullPath = resolvePathUnderRoot(tempDir, filePath, "repository file path");
                            const content = await readFile(fullPath);
                            const hash = computeFileHash(content);
                            const existingNode = nodeByPath.get(filePath);

                            if (existingNode?.type === "file" && existingNode.gitHash === hash) {
                                return null;
                            }

                            const fileName = filePath.split("/").pop() ?? filePath;
                            const s3Key = existingNode?.type === "file" && existingNode.s3Key
                                ? existingNode.s3Key
                                : buildProjectFileKey(projectId, `${randomUUID()}/${fileName}`);
                            const storage = adminClient.storage.from("project-files");
                            try {
                                const { error: storageError } = existingNode?.type === "file" && existingNode.s3Key
                                    ? await storage.update(s3Key, content, {
                                        contentType: "application/octet-stream",
                                        cacheControl: "3600",
                                        upsert: true,
                                    })
                                    : await storage.upload(s3Key, content, {
                                        contentType: "application/octet-stream",
                                        cacheControl: "3600",
                                    });
                                if (storageError) throw storageError;
                            } catch (error) {
                                failedUploads += 1;
                                logger.warn("github.sync.pull.storage_write_failed", {
                                    projectId,
                                    path: filePath,
                                    s3Key,
                                    hash,
                                    nodeId: existingNode?.id ?? null,
                                    error: errorMessage(error),
                                });
                                // Leave the database hash/key unchanged so the next pull retries this file.
                                return null;
                            }

                            const isUpdate = existingNode?.type === "file";
                            return {
                                kind: isUpdate ? "updated" as const : "new" as const,
                                node: {
                                    id: isUpdate ? existingNode.id : randomUUID(),
                                    projectId,
                                    parentId: isUpdate ? existingNode.parentId : (folderCache.get(dirname(filePath)) ?? null),
                                    type: "file" as const,
                                    name: fileName,
                                    s3Key,
                                    size: content.length,
                                    gitHash: hash,
                                    createdBy: userId,
                                    ...(isUpdate ? { updatedAt: new Date() } : {}),
                                },
                            };
                        },
                    );
                    const confirmedUploads = uploadResults.filter((result) => result !== null);
                    const nodesToUpsert = confirmedUploads.map((result) => result.node);
                    newCount = confirmedUploads.filter((result) => result.kind === "new").length;
                    updatedCount = confirmedUploads.filter((result) => result.kind === "updated").length;

                    // Bulk upsert new and updated nodes
                    if (nodesToUpsert.length > 0) {
                        await db.insert(projectNodes)
                            .values(nodesToUpsert)
                            .onConflictDoUpdate({
                                target: projectNodes.id,
                                set: {
                                    s3Key: sql`excluded.s3_key`,
                                    gitHash: sql`excluded.git_hash`,
                                    size: sql`excluded.size`,
                                    updatedAt: sql`excluded.updated_at`,
                                }
                            });
                    }
                    if (failedUploads > 0) {
                        throw new Error(`Git pull left ${failedUploads} Storage write(s) pending retry`);
                    }

                    const idsToDelete: string[] = [];
                    for (const node of existingNodes) {
                        if (node.type !== "file") continue;
                        const path = buildNodePath(node.id, nodesById);
                        if (!seenPaths.has(path)) {
                            idsToDelete.push(node.id);
                        }
                    }

                    if (idsToDelete.length > 0) {
                        await db
                            .update(projectNodes)
                            .set({ deletedAt: new Date(), deletedBy: userId })
                            .where(inArray(projectNodes.id, idsToDelete));
                        deletedCount = idsToDelete.length;
                    }

                    const latestSha = await readLatestCommitSha(tempDir);

                    await db
                        .update(projects)
                        .set({
                            githubLastSyncAt: new Date(),
                            githubLastCommitSha: latestSha,
                        })
                        .where(eq(projects.id, projectId));

                    await db.insert(projectNodeEvents).values({
                        projectId,
                        actorId: userId,
                        type: "git_pull",
                        metadata: {
                            commitSha: latestSha,
                            newFiles: newCount,
                            updatedFiles: updatedCount,
                            deletedFiles: deletedCount,
                            failedUploads,
                            authSource: access.source,
                            installationId: access.installationId,
                            deliveryId: deliveryId ?? null,
                        },
                    });

                    logger.metric("github.sync.pull.completed", {
                        projectId,
                        commitSha: latestSha,
                        newFiles: newCount,
                        updatedFiles: updatedCount,
                        deletedFiles: deletedCount,
                        failedUploads,
                        authSource: access.source,
                        installationId: access.installationId,
                    });

                    return {
                        success: true,
                        newFiles: newCount,
                        updatedFiles: updatedCount,
                        deletedFiles: deletedCount,
                        failedUploads,
                    };
                } finally {
                    await cleanupTemporaryDirectory(tempDir, "pull");
                }
            }));

            if (tenantLockedRun.skipped) {
                logger.metric("github.sync.pull.skipped", {
                    projectId,
                    reason: "tenant-concurrency",
                    deliveryId: deliveryId ?? null,
                });
                return { success: true, skipped: "tenant_in_progress" as const };
            }

            if (tenantLockedRun.value?.skipped) {
                logger.metric("github.sync.pull.skipped", {
                    projectId,
                    reason: "lock-in-progress",
                    deliveryId: deliveryId ?? null,
                });
                return { success: true, skipped: "in_progress" as const };
            }

            return tenantLockedRun.value?.value;
        });
    },
);

export const uploadIntentCleanup = inngest.createFunction(
    { id: "upload-intent-cleanup", concurrency: 1 },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        return step.run("cleanup-expired-intents", cleanupExpiredUploadIntents);
    }
);

export const lockCleanup = inngest.createFunction(
    { id: "lock-cleanup" },
    { cron: "*/5 * * * *" },
    async () => {
        let deleted = 0;
        for (let batch = 0; batch < 10; batch += 1) {
            const count = await deleteExpiredFileLeases(1_000);
            deleted += count;
            if (count < 1_000) break;
        }
        logger.info("files.lock.cleanup.completed", {
            module: "files",
            deleted,
        });
        return { cleaned: true, deleted };
    },
);
