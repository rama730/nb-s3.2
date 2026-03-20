import { inngest } from "../client";
import simpleGit from "simple-git";
import { db } from "@/lib/db";
import { projects, projectNodes, projectNodeEvents, projectNodeLocks } from "@/lib/db/schema";
import { eq, and, isNull, lt, sql } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/server";
import { tmpdir } from "os";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises";
import { join, relative, dirname } from "path";
import { readdirSync, statSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { appendSafePathSegment, resolvePathUnderRoot } from "@/lib/security/path-safety";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { assertRepositoryWithinBudgets, GITHUB_WORKER_BUDGETS, withTenantSyncLock } from "@/lib/github/worker-guard";
import { withGitCredentialEnv } from "@/lib/github/git-auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = (() => {
    const v = Number(process.env.GITHUB_IMPORT_CLONE_TIMEOUT_MS || 120000);
    return Number.isFinite(v) && v >= 30_000 ? Math.floor(v) : 120000;
})();
const LOCK_NAMESPACE = "project-git-sync";

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

function walkDir(dir: string, base: string = dir): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (entry === ".git") continue;
        const full = appendSafePathSegment(dir, entry, "repository entry");
        const stat = statSync(full);
        if (stat.isDirectory()) {
            results.push(...walkDir(full, base));
        } else {
            results.push(relative(base, full));
        }
    }
    return results;
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
    const cloneArgs = [
        "clone",
        repoUrl,
        tempDir,
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        branch,
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
    const pushArgs = ["-C", tempDir, "push", "origin", branch];
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
    } catch {
        return null;
    }
}

export const gitPush = inngest.createFunction(
    { id: "git-push", retries: 1, concurrency: 4 },
    { event: "git/push" },
    async ({ event, step }) => {
        const { projectId, commitMessage, userId } = event.data;

        logger.metric("github.sync.push.start", {
            projectId,
            userId,
            commitMessage,
            queueAgeMs: resolveQueueAgeMs(event as { ts?: string | number | null }),
        });

        await step.run("push-to-github", async () => {
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

            const tenantLockedRun = await withTenantSyncLock(userId, async () => withProjectSyncLock(projectId, async () => {
                const tempDir = await mkdtemp(join(tmpdir(), "nb-git-push-"));

                try {
                    await cloneRepository(project.githubRepoUrl!, tempDir, branch, access.token);
                    assertRepositoryWithinBudgets(tempDir, { job: "git push", projectId });

                    const activeNodes = await db
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
                        activeNodes.map((n) => [n.id, { name: n.name, parentId: n.parentId }]),
                    );
                    const adminClient = await createAdminClient();
                    const repoFiles = new Set(walkDir(tempDir));

                    const fileNodes = activeNodes.filter((n) => n.type === "file" && n.s3Key);
                    await runWithConcurrency(fileNodes, GITHUB_WORKER_BUDGETS.applyConcurrency, async (node) => {
                        const filePath = buildNodePath(node.id, nodesById);
                        const targetPath = resolvePathUnderRoot(tempDir, filePath, "workspace file path");
                        repoFiles.delete(filePath);

                        if (node.gitHash) {
                            try {
                                const existingBuffer = await readFile(targetPath);
                                if (computeFileHash(existingBuffer) === node.gitHash) {
                                    return;
                                }
                            } catch {
                                // Missing or unreadable file should be rewritten from workspace state.
                            }
                        }

                        await mkdir(dirname(targetPath), { recursive: true });

                        const { data, error } = await adminClient.storage
                            .from("project-files")
                            .download(node.s3Key!);

                        if (error) {
                            logger.warn("github.sync.push.storage.download_failed", {
                                projectId,
                                s3Key: node.s3Key,
                                error: error.message,
                            });
                            return;
                        }

                        if (!data) {
                            return;
                        }

                        const buffer = Buffer.from(await data.arrayBuffer());
                        await writeFile(targetPath, buffer);
                    });

                    await runWithConcurrency(
                        Array.from(repoFiles),
                        GITHUB_WORKER_BUDGETS.applyConcurrency,
                        async (repoFilePath) => {
                            const targetPath = resolvePathUnderRoot(tempDir, repoFilePath, "workspace removal path");
                            await rm(targetPath, { force: true }).catch(() => {});
                        },
                    );

                    const repoGit = simpleGit(tempDir);
                    await repoGit.addConfig("user.email", "bot@networkbuilders.local");
                    await repoGit.addConfig("user.name", "Network Builders Bot");
                    await repoGit.add(".");

                    const status = await repoGit.status();
                    if (status.files.length === 0) {
                        await db
                            .update(projects)
                            .set({
                                githubLastSyncAt: new Date(),
                            })
                            .where(eq(projects.id, projectId));
                        logger.metric("github.sync.push.skipped", {
                            projectId,
                            reason: "no_changes",
                        });
                        return { success: true, skipped: "no_changes" as const };
                    }

                    await repoGit.commit(commitMessage || "Update from NB workspace");
                    await pushRepository(tempDir, branch, access.token);

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
                        type: "git_push",
                        metadata: {
                            commitMessage,
                            commitSha: latestSha,
                            fileCount: fileNodes.length,
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
                    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
                }
            }));

            if (tenantLockedRun.skipped) {
                logger.metric("github.sync.push.skipped", {
                    projectId,
                    reason: "tenant-concurrency",
                });
                return { success: true, skipped: "tenant_in_progress" as const };
            }
            if (tenantLockedRun.value?.skipped) {
                logger.metric("github.sync.push.skipped", {
                    projectId,
                    reason: "lock-in-progress",
                });
                return { success: true, skipped: "in_progress" as const };
            }
            return tenantLockedRun.value?.value;
        });
    },
);

export const gitPull = inngest.createFunction(
    { id: "git-pull", retries: 1, concurrency: 4 },
    { event: "git/pull" },
    async ({ event, step }) => {
        const { projectId, userId, deliveryId } = event.data;

        logger.metric("github.sync.pull.start", {
            projectId,
            userId,
            deliveryId: deliveryId || null,
            queueAgeMs: resolveQueueAgeMs(event as { ts?: string | number | null }),
        });

        await step.run("pull-from-github", async () => {
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

            const tenantLockedRun = await withTenantSyncLock(userId, async () => withProjectSyncLock(projectId, async () => {
                const tempDir = await mkdtemp(join(tmpdir(), "nb-git-pull-"));

                try {
                    await cloneRepository(project.githubRepoUrl!, tempDir, branch, access.token);
                    assertRepositoryWithinBudgets(tempDir, { job: "git pull", projectId });

                    const repoFiles = walkDir(tempDir);

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

                        folderCache.set(folderPath, created.id);
                        return created.id;
                    }

                    let newCount = 0;
                    let updatedCount = 0;

                    for (const filePath of repoFiles) {
                        seenPaths.add(filePath);
                        const fullPath = resolvePathUnderRoot(tempDir, filePath, "repository file path");
                        const content = await readFile(fullPath);
                        const hash = computeFileHash(content);

                        const existingNode = nodeByPath.get(filePath);

                        if (existingNode && existingNode.type === "file") {
                            if (existingNode.gitHash === hash) continue;

                            const fileName = filePath.split("/").pop() ?? filePath;
                            let nextS3Key = existingNode.s3Key ?? null;

                            if (nextS3Key) {
                                const { error: updateError } = await adminClient.storage
                                    .from("project-files")
                                    .update(nextS3Key, content, {
                                        contentType: "application/octet-stream",
                                        upsert: true,
                                    });
                                if (updateError) {
                                    logger.warn("github.sync.pull.storage.update_failed", {
                                        projectId,
                                        s3Key: nextS3Key,
                                        hash,
                                        error: updateError.message,
                                    });
                                    continue;
                                }
                            } else {
                                const createdS3Key = buildProjectFileKey(projectId, `${randomUUID()}/${fileName}`);
                                const { error: uploadError } = await adminClient.storage
                                    .from("project-files")
                                    .upload(createdS3Key, content, {
                                        contentType: "application/octet-stream",
                                    });
                                if (uploadError) {
                                    logger.warn("github.sync.pull.storage.upload_failed_missing_key", {
                                        projectId,
                                        s3Key: createdS3Key,
                                        hash,
                                        nodeId: existingNode.id,
                                        error: uploadError.message,
                                    });
                                    continue;
                                }
                                nextS3Key = createdS3Key;
                            }

                            await db
                                .update(projectNodes)
                                .set({
                                    s3Key: nextS3Key,
                                    gitHash: hash,
                                    size: content.length,
                                    updatedAt: new Date(),
                                })
                                .where(eq(projectNodes.id, existingNode.id));
                            updatedCount++;
                        } else {
                            const dir = dirname(filePath);
                            const parentId = await ensureFolder(dir);
                            const fileName = filePath.split("/").pop() ?? filePath;

                            const s3Key = buildProjectFileKey(projectId, `${randomUUID()}/${fileName}`);
                            const { error: uploadError } = await adminClient.storage
                                .from("project-files")
                                .upload(s3Key, content, {
                                    contentType: "application/octet-stream",
                                });

                            if (uploadError) {
                                logger.warn("github.sync.pull.storage.upload_failed", {
                                    projectId,
                                    s3Key,
                                    hash,
                                    error: uploadError.message,
                                });
                                continue;
                            }

                            await db.insert(projectNodes).values({
                                projectId,
                                parentId,
                                type: "file",
                                name: fileName,
                                s3Key,
                                size: content.length,
                                gitHash: hash,
                                createdBy: userId,
                            });
                            newCount++;
                        }
                    }

                    let deletedCount = 0;
                    for (const node of existingNodes) {
                        if (node.type !== "file") continue;
                        const path = buildNodePath(node.id, nodesById);
                        if (!seenPaths.has(path)) {
                            await db
                                .update(projectNodes)
                                .set({ deletedAt: new Date(), deletedBy: userId })
                                .where(eq(projectNodes.id, node.id));
                            deletedCount += 1;
                        }
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
                        authSource: access.source,
                        installationId: access.installationId,
                    });

                    return {
                        success: true,
                        newFiles: newCount,
                        updatedFiles: updatedCount,
                        deletedFiles: deletedCount,
                    };
                } finally {
                    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

export const lockCleanup = inngest.createFunction(
    { id: "lock-cleanup" },
    { cron: "*/5 * * * *" },
    async () => {
        await db
            .delete(projectNodeLocks)
            .where(lt(projectNodeLocks.expiresAt, new Date()));

        return { cleaned: true };
    },
);
