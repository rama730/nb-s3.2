import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectNodes, projects } from "@/lib/db/schema";
import { createDirectoryStructureFromPaths, insertVirtualFileNodes } from "@/lib/import/utils";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import {
  clearSealedGithubTokenFromImportSource,
  sanitizeGitErrorMessage,
} from "@/lib/github/repo-security";
import { withGitCredentialEnv } from "@/lib/github/git-auth";
import {
  normalizeGithubBranch,
  normalizeGithubRepoUrl,
} from "@/lib/github/repo-validation";
import {
  withTenantSyncLock,
  GITHUB_WORKER_BUDGETS,
} from "@/lib/github/worker-guard";
import { fetchGithubTree } from "@/lib/github/tree-api";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const GIT_CLONE_TIMEOUT_MS = (() => {
  const v = Number(process.env.GITHUB_IMPORT_CLONE_TIMEOUT_MS || 120000);
  return Number.isFinite(v) && v >= 30_000 ? Math.floor(v) : 120000;
})();

const LOCK_NAMESPACE = "project-git-sync";
const RECONCILE_DELETE_BATCH_SIZE = 1000;

export type GithubProjectImportSource = {
  type: "github";
  repoUrl?: string | null;
  branch?: string | null;
  metadata?: Record<string, any> | null;
};

export type GithubProjectImportResult =
  | {
      success: true;
      fileCount: number;
      commitSha: string | null;
    }
  | {
      success: true;
      skipped: "project_in_progress" | "tenant_in_progress";
    };

export function resolveGithubProjectImportQueueAgeMs(event: {
  ts?: string | number | null;
}) {
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
    const { stdout } = await execFileAsync(
      "git",
      ["-C", tempDir, "rev-parse", "HEAD"],
      {
        timeout: 15_000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
        maxBuffer: 512 * 1024,
      },
    );
    const sha = String(stdout || "").trim();
    return sha || null;
  } catch {
    return null;
  }
}

export async function markGithubProjectImportFailed(input: {
  projectId: string;
  importEventId?: string | null;
  error: unknown;
}) {
  const { projectId, importEventId, error } = input;
  const errorMessage = sanitizeGitErrorMessage(
    error instanceof Error ? error.message : "Unknown error",
  );

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
      syncProgress: null,
      importEventId:
        importEventId ??
        ((src?.metadata || {}) as Record<string, unknown>).importEventId ??
        null,
    },
  };

  await db
    .update(projects)
    .set({
      syncStatus: "failed",
      importSource: nextImportSource as any,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
}

export async function runGithubProjectImport(input: {
  projectId: string;
  importSource: GithubProjectImportSource;
  userId: string;
  importEventId?: string | null;
  queueAgeMs?: number | null;
  resolutions?: Record<string, "keep_local" | "overwrite_github"> | null;
}): Promise<GithubProjectImportResult> {
  const { projectId, importSource, userId, resolutions } = input;
  const importEventId = input.importEventId ?? null;
  const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || "");
  const branch = normalizeGithubBranch(importSource.branch ?? undefined);

  try {
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
      queueAgeMs: input.queueAgeMs ?? null,
    });

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
        return { success: true as const, skipped: "project_in_progress" as const };
      }

      try {
        const [project] = await db
          .select({ importSource: projects.importSource })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        if (!project) {
          throw new Error("Project not found");
        }

        const existingSource = clearSealedGithubTokenFromImportSource(
          project.importSource,
        ) as Record<string, unknown>;
        const sourceMetadata = ((existingSource?.metadata || {}) as Record<
          string,
          unknown
        >);
        const nextBranch =
          branch ||
          (typeof existingSource?.branch === "string"
            ? existingSource.branch
            : "main");

        await db
          .update(projects)
          .set({
            syncStatus: "cloning",
            updatedAt: new Date(),
            githubRepoUrl: repoUrl,
            githubDefaultBranch: nextBranch,
            importSource: {
              ...existingSource,
              type: "github",
              repoUrl,
              branch: nextBranch,
              metadata: {
                ...sourceMetadata,
                syncPhase: "cloning",
                importEventId: importEventId ?? sourceMetadata.importEventId ?? null,
                lastError: null,
              },
            } as any,
          })
          .where(eq(projects.id, projectId));

        const preferredInstallationIdRaw =
          sourceMetadata.githubInstallationId ??
          (importSource?.metadata as Record<string, unknown> | undefined)
            ?.githubInstallationId ??
          null;
        const preferredInstallationId =
          typeof preferredInstallationIdRaw === "number" ||
          typeof preferredInstallationIdRaw === "string"
            ? preferredInstallationIdRaw
            : null;
        const access = await resolveGithubRepoAccess({
          repoUrl,
          preferredInstallationId,
          sealedImportToken:
            sourceMetadata.importAuth ?? importSource?.metadata?.importAuth,
        });
        const accessToken = access.token || undefined;

        
        const treeData = await fetchGithubTree(repoUrl, nextBranch, accessToken);
        const { nodes, commitSha: latestSha } = treeData;

        let fileCount = 0;
        let totalBytes = 0;
        for (const n of nodes) {
            if (n.type === "file") {
                fileCount++;
                totalBytes += n.size;
            }
        }

        if (fileCount > GITHUB_WORKER_BUDGETS.maxFiles) {
            throw new Error(
                `project import rejected for project ${projectId}: repository exceeds file budget (${fileCount} > ${GITHUB_WORKER_BUDGETS.maxFiles})`
            );
        }
        if (totalBytes > GITHUB_WORKER_BUDGETS.maxBytes) {
            throw new Error(
                `project import rejected for project ${projectId}: repository exceeds byte budget (${totalBytes} > ${GITHUB_WORKER_BUDGETS.maxBytes})`
            );
        }

        await db
          .update(projects)
          .set({
            syncStatus: "indexing",
            updatedAt: new Date(),
            githubRepoUrl: repoUrl,
            githubDefaultBranch: nextBranch,
            importSource: {
              ...existingSource,
              type: "github",
              repoUrl,
              branch: nextBranch,
              metadata: {
                ...sourceMetadata,
                syncPhase: "indexing",
                importEventId: importEventId ?? sourceMetadata.importEventId ?? null,
                lastError: null,
                fileBudgetCount: fileCount,
                byteBudgetCount: totalBytes,
              },
            } as any,
          })
          .where(eq(projects.id, projectId));

        const dirPaths = new Set<string>();
        for (const n of nodes) {
            if (n.type === "folder") {
                dirPaths.add(n.path);
            } else {
                const dir = n.path.split("/").slice(0, -1).join("/");
                if (dir && dir !== ".") {
                    const parts = dir.split("/");
                    let current = "";
                    for (const part of parts) {
                        current = current ? `${current}/${part}` : part;
                        dirPaths.add(current);
                    }
                }
            }
        }

        const folderMap = await createDirectoryStructureFromPaths(
          projectId,
          dirPaths,
          userId,
        );

        const fileNodes = nodes.filter((n) => n.type === "file");
        
        // --- START RECONCILIATION ---
        
        // 1. Get existing project file nodes
        const localNodes = await db
          .select({
            id: projectNodes.id,
            path: projectNodes.path,
            gitHash: projectNodes.gitHash,
            s3Key: projectNodes.s3Key,
            currentVersion: projectNodes.currentVersion,
          })
          .from(projectNodes)
          .where(
            and(
              eq(projectNodes.projectId, projectId),
              isNull(projectNodes.deletedAt),
              eq(projectNodes.type, "file")
            )
          );

        const localMap = new Map(localNodes.map((n) => [n.path, n]));
        const filesToInsert: typeof fileNodes = [];
        const filesToUpdate: Array<{
          id: string;
          git_hash: string;
          size: number;
          current_version: number;
        }> = [];
        const resolutionMap = resolutions || {};

        // Track remote paths to detect deletions
        const remotePaths = new Set<string>();

        // 2. Classify remote files
        const totalFilesToProcess = fileNodes.length;
        const updateProgress = async (processed: number, phase: string, msg: string) => {
          const percentage = totalFilesToProcess > 0 ? Math.round((processed / totalFilesToProcess) * 100) : 100;
          await db
            .update(projects)
            .set({
              importSource: {
                ...existingSource,
                metadata: {
                  ...sourceMetadata,
                  syncPhase: phase,
                  syncProgress: {
                    total: totalFilesToProcess,
                    processed,
                    percentage,
                    message: msg,
                  },
                },
              } as any,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));
        };

        await updateProgress(0, "reconciling", "Analyzing repository changes...");

        for (const remote of fileNodes) {
          const normalizedPath = `/${remote.path.replace(/^\//, "")}`;
          remotePaths.add(normalizedPath);
          const local = localMap.get(normalizedPath);

          if (local) {
            const isLocallyModified = local.s3Key !== null;
            const isRemoteModified = local.gitHash !== remote.sha;

            if (isRemoteModified) {
              const res = resolutionMap[remote.path];
              // Overwrite if user specifically chose to, OR if it's unmodified locally
              const shouldOverwrite = res === "overwrite_github" || (!isLocallyModified);

              if (shouldOverwrite) {
                filesToUpdate.push({
                  id: local.id,
                  git_hash: remote.sha,
                  size: remote.size,
                  current_version: local.currentVersion + 1,
                });
              }
            }
          } else {
            // New file -> safe to insert
            filesToInsert.push(remote);
          }

        }

        // 3. Handle remote deletions
        const nodeIdsToDelete: string[] = [];
        for (const local of localNodes) {
          if (!remotePaths.has(local.path)) {
            // Check if local was modified and user chose to keep it
            const relativePath = local.path.replace(/^\//, "");
            const res = resolutionMap[relativePath];
            const isLocallyModified = local.s3Key !== null;
            const shouldKeep = res === "keep_local" || (isLocallyModified && res !== "overwrite_github");

            if (!shouldKeep) {
              nodeIdsToDelete.push(local.id);
            }
          }
        }

        await db.transaction(async (tx) => {
          for (let index = 0; index < filesToUpdate.length; index += RECONCILE_DELETE_BATCH_SIZE) {
            const batch = filesToUpdate.slice(index, index + RECONCILE_DELETE_BATCH_SIZE);
            await tx.execute(sql`
              UPDATE project_nodes node
              SET git_blob_hash = patch.git_hash,
                  s3_key = NULL,
                  size = patch.size,
                  current_version = patch.current_version,
                  updated_at = now()
              FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
                AS patch(id uuid, git_hash text, size bigint, current_version integer)
              WHERE node.id = patch.id
                AND node.project_id = ${projectId}::uuid
                AND node.deleted_at IS NULL
            `);
          }
          for (let index = 0; index < nodeIdsToDelete.length; index += RECONCILE_DELETE_BATCH_SIZE) {
            const batch = nodeIdsToDelete.slice(index, index + RECONCILE_DELETE_BATCH_SIZE);
            await tx
              .update(projectNodes)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, batch)));
          }
        });

        // 4. Insert brand new files
        if (filesToInsert.length > 0) {
          await insertVirtualFileNodes(projectId, filesToInsert, folderMap, userId);
        }

        await updateProgress(totalFilesToProcess, "reconciling", "Repository changes applied.");
        
        // --- END RECONCILIATION ---

        // Schedule background hydration
        // We trigger an Inngest event for Phase 2 Tarball Stream
        const { inngest } = await import("@/inngest/client");
        await inngest.send({
            name: "project/import.hydrate",
            data: { projectId, userId, importSource: project.importSource as any }
        }).catch(err => {
            if (err?.message?.includes('401') || err?.message?.includes('Event key not found')) {
                // Ignore in development if Inngest is not configured
                console.warn("[Hydration] Skipped Inngest hydration: Inngest event key not configured. Virtual FS is ready.");
            } else {
                console.error("Failed to enqueue hydration, but virtual fs is ready", err);
            }
        });

        const importedNodeIds = new Set<string>(folderMap.values());
        // Since we are doing bulk insert with onConflictDoNothing, getting touchedNodeIds is complex.
        // We'll skip stale node deletion for virtual imports for now, or just let them stay.

        await db
            .update(projects)
            .set({
              syncStatus: "ready",
              githubLastSyncAt: new Date(),
              githubLastCommitSha: latestSha,
              updatedAt: new Date(),
              importSource: {
                ...existingSource,
                metadata: {
                  ...sourceMetadata,
                  syncPhase: "ready",
                  syncProgress: null,
                },
              } as any,
            })
            .where(eq(projects.id, projectId));

        logger.metric("github.import.worker.complete", {
            projectId,
            fileCount,
            authSource: access.source,
            installationId: access.installationId,
            commitSha: latestSha,
        });

        return {
            success: true as const,
            fileCount,
            commitSha: latestSha,
        };

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
      return { success: true, skipped: "tenant_in_progress" };
    }

    return tenantLockedRun.value ?? { success: true, skipped: "tenant_in_progress" as const };
  } catch (error) {
    await markGithubProjectImportFailed({ projectId, importEventId, error });
    throw error;
  }
}
