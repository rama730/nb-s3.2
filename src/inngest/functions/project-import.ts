
import { inngest } from "../client";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createDirectoryStructureFromRoot, uploadRepoFiles } from "@/lib/import/utils";
import { clearSealedGithubTokenFromImportSource, openGithubImportToken, sanitizeGitErrorMessage } from "@/lib/github/repo-security";
import { normalizeGithubBranch, normalizeGithubRepoUrl } from "@/lib/github/repo-validation";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_CLONE_TIMEOUT_MS = (() => {
    const v = Number(process.env.GITHUB_IMPORT_CLONE_TIMEOUT_MS || 120000);
    return Number.isFinite(v) && v >= 30_000 ? Math.floor(v) : 120000;
})();

export const projectImport = inngest.createFunction(
    { id: "project-import", concurrency: 5 },
    { event: "project/import" },
    async ({ event, step }) => {
        const { projectId, importSource, userId } = event.data;
        const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || "");
        const branch = normalizeGithubBranch(importSource.branch);

        if (!repoUrl) {
            throw new Error("Invalid GitHub repository URL");
        }
        if (importSource.branch && !branch) {
            throw new Error("Invalid GitHub branch name");
        }

        console.log(`[Inngest] Starting import for ${projectId}`, {
            repoUrl,
            branch,
        });

        try {
            // CRITICAL: We combine cloning and uploading into ONE step.
            // Why? In Serverless, steps can run on different servers. 
            // If we clone in step 1, the files are on Server A. 
            // If Step 2 runs on Server B, the files are gone.
            // By keeping them in one step, we ensure atomicity on the ephemeral filesystem.
            await step.run("clone-and-process", async () => {
                const lockResult = await db.execute<{ locked: boolean }>(sql`
                    SELECT pg_try_advisory_lock(
                        hashtext('project-import'),
                        hashtext(CAST(${projectId} AS text))
                    ) AS locked
                `);
                const lockRow = Array.from(lockResult)[0];
                const lockAcquired = !!lockRow?.locked;
                if (!lockAcquired) {
                    throw new Error("Import already in progress for this project");
                }

                try {
                    // 1. Status Update
                    await db.update(projects).set({ syncStatus: "cloning" }).where(eq(projects.id, projectId));

                    const [project] = await db
                        .select({ importSource: projects.importSource })
                        .from(projects)
                        .where(eq(projects.id, projectId))
                        .limit(1);

                    const sealedToken = (project?.importSource as any)?.metadata?.importAuth;
                    const accessToken = openGithubImportToken(sealedToken);

                    // 2. Setup Temp Dir
                    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-import-"));

                    try {
                        // 3. Clone with bounded timeout and non-interactive git.
                        const cloneArgs = [
                            "clone",
                            repoUrl,
                            tempDir,
                            "--depth",
                            "1",
                            ...(branch ? ["--branch", branch] : []),
                        ];
                        if (accessToken) {
                            const basic = Buffer.from(`x-access-token:${accessToken}`).toString("base64");
                            cloneArgs.unshift("-c", `http.extraHeader=Authorization: Basic ${basic}`);
                        }
                        await execFileAsync("git", cloneArgs, {
                            timeout: GIT_CLONE_TIMEOUT_MS,
                            env: {
                                ...process.env,
                                GIT_TERMINAL_PROMPT: "0",
                            },
                            maxBuffer: 4 * 1024 * 1024,
                        });

                        // 4. Update Status -> Indexing
                        await db.update(projects).set({ syncStatus: "indexing" }).where(eq(projects.id, projectId));

                        // 5. Scan & Upload
                        const folderMap = await createDirectoryStructureFromRoot(projectId, tempDir, userId);
                        const uploadResult = await uploadRepoFiles(projectId, tempDir, folderMap, userId);
                        if (uploadResult.failed > 0) {
                            throw new Error(`Import completed with ${uploadResult.failed} failed file uploads`);
                        }

                        // 6. Complete
                        const nextImportSource = clearSealedGithubTokenFromImportSource(project?.importSource);
                        await db
                            .update(projects)
                            .set({ syncStatus: "ready", importSource: nextImportSource as any })
                            .where(eq(projects.id, projectId));

                        return { success: true, fileCount: uploadResult.processed };
                    } finally {
                        // Cleanup in the same step
                        await fs.rm(tempDir, { recursive: true, force: true });
                    }
                } finally {
                    await db.execute(sql`
                        SELECT pg_advisory_unlock(
                            hashtext('project-import'),
                            hashtext(CAST(${projectId} AS text))
                        )
                    `);
                }
            });

        } catch (error: any) {
            await step.run("handle-failure", async () => {
                const errorMessage = sanitizeGitErrorMessage(error instanceof Error ? error.message : "Unknown error");
                console.error(`[Inngest] Import failed for ${projectId}: ${errorMessage}`);

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
                    },
                };

                await db.update(projects).set({
                    syncStatus: "failed",
                    importSource: nextImportSource as any,
                }).where(eq(projects.id, projectId));
            });
            throw error;
        }
    }
);
