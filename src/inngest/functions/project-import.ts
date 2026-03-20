import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectNodes, projects } from "@/lib/db/schema";
import { createDirectoryStructureFromRoot, uploadRepoFiles } from "@/lib/import/utils";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { clearSealedGithubTokenFromImportSource, sanitizeGitErrorMessage } from "@/lib/github/repo-security";
import { withGitCredentialEnv } from "@/lib/github/git-auth";
import { normalizeGithubBranch, normalizeGithubRepoUrl } from "@/lib/github/repo-validation";
import { assertRepositoryWithinBudgets, withTenantSyncLock } from "@/lib/github/worker-guard";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const GIT_CLONE_TIMEOUT_MS = (() => {
    const v = Number(process.env.GITHUB_IMPORT_CLONE_TIMEOUT_MS || 120000);
    return Number.isFinite(v) && v >= 30_000 ? Math.floor(v) : 120000;
})();

const LOCK_NAMESPACE = "project-git-sync";
const RECONCILE_DELETE_BATCH_SIZE = 1000;

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

export const projectImport = inngest.createFunction(
    { id: "project-import", concurrency: 5 },
    { event: "project/import" },
    async ({ event, step }) => {
        const { projectId, importSource, userId } = event.data;
        const importEventId = event.id || null;
        const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || "");
        const branch = normalizeGithubBranch(importSource.branch);

        if (!repoUrl) {
            throw new Error("Invalid GitHub repository URL");
        }
        if (importSource.branch && !branch) {
            throw new Error("Invalid GitHub branch name");
        }

        logger.metric("github.import.worker.start", {
            projectId,
            repoUrl,
            branch: branch || null,
            queueAgeMs: resolveQueueAgeMs(event as { ts?: string | number | null }),
        });

        try {
            const cloneResult = await step.run("clone-and-process", async () => {
                const tenantLockedRun = await withTenantSyncLock(userId, async () => {
                    const lockResult = await db.execute<{ locked: boolean }>(sql`
                        SELECT pg_try_advisory_lock(
                            hashtext(${LOCK_NAMESPACE}),
                            hashtext(CAST(${projectId} AS text))
                        ) AS locked
                    `);
                    const lockRow = Array.from(lockResult)[0];
                    const lockAcquired = !!lockRow?.locked;
                    if (!lockAcquired) {
                        logger.metric("github.import.worker.skipped", {
                            projectId,
                            reason: "lock-in-progress",
                        });
                        return { success: true, skipped: "in_progress" as const };
                    }

                    try {
                        const [project] = await db
                            .select({ importSource: projects.importSource })
                            .from(projects)
                            .where(eq(projects.id, projectId))
                            .limit(1);

                        const existingSource = clearSealedGithubTokenFromImportSource(project?.importSource) as Record<string, unknown>;
                        const sourceMetadata = ((existingSource?.metadata || {}) as Record<string, unknown>);
                        await db.update(projects).set({
                            syncStatus: "cloning",
                            updatedAt: new Date(),
                            importSource: {
                                ...existingSource,
                                type: "github",
                                repoUrl,
                                branch: branch || (typeof existingSource?.branch === "string" ? existingSource.branch : "main"),
                                metadata: {
                                    ...sourceMetadata,
                                    syncPhase: "cloning",
                                    importEventId: importEventId ?? sourceMetadata.importEventId ?? null,
                                    lastError: null,
                                },
                            } as any,
                        }).where(eq(projects.id, projectId));

                        const preferredInstallationIdRaw =
                            sourceMetadata.githubInstallationId ??
                            (importSource?.metadata as Record<string, unknown> | undefined)?.githubInstallationId ??
                            null;
                        const preferredInstallationId =
                            typeof preferredInstallationIdRaw === "number" || typeof preferredInstallationIdRaw === "string"
                                ? preferredInstallationIdRaw
                                : null;
                        const access = await resolveGithubRepoAccess({
                            repoUrl,
                            preferredInstallationId,
                            sealedImportToken: sourceMetadata.importAuth ?? importSource?.metadata?.importAuth,
                        });
                        const accessToken = access.token || undefined;

                        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-import-"));
                        try {
                            const cloneArgs = [
                                "clone",
                                repoUrl,
                                tempDir,
                                "--depth",
                                "1",
                                ...(branch ? ["--branch", branch] : []),
                            ];
                            await withGitCredentialEnv(accessToken, async (gitEnv) =>
                                execFileAsync("git", cloneArgs, {
                                    timeout: GIT_CLONE_TIMEOUT_MS,
                                    env: gitEnv,
                                    maxBuffer: 4 * 1024 * 1024,
                                })
                            );

                            const repoBudget = assertRepositoryWithinBudgets(tempDir, {
                                job: "project import",
                                projectId,
                            });

                            await db.update(projects).set({
                                syncStatus: "indexing",
                                updatedAt: new Date(),
                                importSource: {
                                    ...existingSource,
                                    type: "github",
                                    repoUrl,
                                    branch: branch || (typeof existingSource?.branch === "string" ? existingSource.branch : "main"),
                                    metadata: {
                                        ...sourceMetadata,
                                        syncPhase: "indexing",
                                        importEventId: importEventId ?? sourceMetadata.importEventId ?? null,
                                        lastError: null,
                                        fileBudgetCount: repoBudget.fileCount,
                                        byteBudgetCount: repoBudget.totalBytes,
                                    },
                                } as any,
                            }).where(eq(projects.id, projectId));

                            const folderMap = await createDirectoryStructureFromRoot(projectId, tempDir, userId);
                            const uploadResult = await uploadRepoFiles(projectId, tempDir, folderMap, userId);
                            if (uploadResult.failed > 0) {
                                throw new Error(`Import completed with ${uploadResult.failed} failed file uploads`);
                            }

                            const importedNodeIds = new Set<string>([
                                ...folderMap.values(),
                                ...uploadResult.touchedNodeIds,
                            ]);

                            await db.transaction(async (tx) => {
                                const activeRows = await tx
                                    .select({ id: projectNodes.id })
                                    .from(projectNodes)
                                    .where(
                                        and(
                                            eq(projectNodes.projectId, projectId),
                                            isNull(projectNodes.deletedAt),
                                        ),
                                    );

                                const staleNodeIds = activeRows
                                    .map((row) => row.id)
                                    .filter((id) => !importedNodeIds.has(id));

                                if (staleNodeIds.length === 0) return;

                                for (let i = 0; i < staleNodeIds.length; i += RECONCILE_DELETE_BATCH_SIZE) {
                                    const staleBatch = staleNodeIds.slice(i, i + RECONCILE_DELETE_BATCH_SIZE);
                                    await tx
                                        .update(projectNodes)
                                        .set({
                                            deletedAt: new Date(),
                                            deletedBy: userId,
                                            updatedAt: new Date(),
                                        })
                                        .where(
                                            and(
                                                eq(projectNodes.projectId, projectId),
                                                isNull(projectNodes.deletedAt),
                                                inArray(projectNodes.id, staleBatch),
                                            ),
                                        );
                                }
                            });

                            const latestSha = await readLatestCommitSha(tempDir);
                            const existingMetadata = ((existingSource?.metadata || {}) as Record<string, unknown>);
                            const nextImportSource = {
                                ...existingSource,
                                type: "github",
                                repoUrl,
                                branch: branch || (typeof existingSource?.branch === "string" ? existingSource.branch : "main"),
                                metadata: {
                                    ...existingMetadata,
                                    githubInstallationId: access.installationId,
                                    githubAuthSource: access.source,
                                    syncPhase: "ready",
                                    importEventId: importEventId ?? existingMetadata.importEventId ?? null,
                                    lastError: null,
                                    fileBudgetCount: repoBudget.fileCount,
                                    byteBudgetCount: repoBudget.totalBytes,
                                },
                            };

                            await db
                                .update(projects)
                                .set({
                                    syncStatus: "ready",
                                    importSource: nextImportSource as any,
                                    githubRepoUrl: repoUrl,
                                    githubDefaultBranch: branch || "main",
                                    githubLastSyncAt: new Date(),
                                    githubLastCommitSha: latestSha,
                                    updatedAt: new Date(),
                                })
                                .where(eq(projects.id, projectId));

                            logger.metric("github.import.worker.complete", {
                                projectId,
                                fileCount: uploadResult.processed,
                                authSource: access.source,
                                installationId: access.installationId,
                                commitSha: latestSha,
                            });

                            return {
                                success: true,
                                fileCount: uploadResult.processed,
                                commitSha: latestSha,
                            };
                        } finally {
                            await fs.rm(tempDir, { recursive: true, force: true });
                        }
                    } finally {
                        await db.execute(sql`
                            SELECT pg_advisory_unlock(
                                hashtext(${LOCK_NAMESPACE}),
                                hashtext(CAST(${projectId} AS text))
                            )
                        `);
                    }
                });

                if (tenantLockedRun.skipped) {
                    logger.metric("github.import.worker.skipped", {
                        projectId,
                        reason: "tenant-concurrency",
                    });
                    return { success: true, skipped: "tenant_in_progress" as const };
                }
                return tenantLockedRun.value;
            });

            if (cloneResult && typeof cloneResult === "object" && "skipped" in cloneResult) {
                return;
            }
        } catch (error: any) {
            await step.run("handle-failure", async () => {
                const errorMessage = sanitizeGitErrorMessage(error instanceof Error ? error.message : "Unknown error");
                logger.metric("github.import.worker.failed", {
                    projectId,
                    error: errorMessage,
                });

                const [project] = await db
                    .select({ importSource: projects.importSource })
                    .from(projects)
                    .where(eq(projects.id, projectId))
                    .limit(1);

                const src = clearSealedGithubTokenFromImportSource(project?.importSource) as any;
                const nextImportSource = {
                    ...(src || {}),
                    metadata: {
                        ...((src?.metadata || {}) as Record<string, unknown>),
                        lastError: errorMessage,
                        syncPhase: "failed",
                        importEventId: importEventId ?? ((src?.metadata || {}) as Record<string, unknown>).importEventId ?? null,
                    },
                };

                await db.update(projects).set({
                    syncStatus: "failed",
                    importSource: nextImportSource as any,
                    updatedAt: new Date(),
                }).where(eq(projects.id, projectId));
            });
            throw error;
        }
    }
);
