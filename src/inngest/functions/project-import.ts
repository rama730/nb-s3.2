
import { inngest } from "../client";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import simpleGit from "simple-git";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createDirectoryStructureFromRoot, uploadRepoFiles } from "@/lib/import/utils";

export const projectImport = inngest.createFunction(
    { id: "project-import", concurrency: 5 },
    { event: "project/import" },
    async ({ event, step }) => {
        const { projectId, importSource, userId, accessToken } = event.data;
        const { repoUrl, branch } = importSource;

        console.log(`[Inngest] Starting import for ${projectId}`, {
            repoUrl,
            branch,
            hasToken: !!accessToken,
            tokenLength: accessToken ? accessToken.length : 0
        });

        try {
            // CRITICAL: We combine cloning and uploading into ONE step.
            // Why? In Serverless, steps can run on different servers. 
            // If we clone in step 1, the files are on Server A. 
            // If Step 2 runs on Server B, the files are gone.
            // By keeping them in one step, we ensure atomicity on the ephemeral filesystem.
            await step.run("clone-and-process", async () => {

                // 1. Status Update
                await db.update(projects).set({ syncStatus: "cloning" }).where(eq(projects.id, projectId));

                // 2. Setup Temp Dir
                const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nb-import-"));

                try {
                    let cloneUrl = repoUrl;
                    if (accessToken && repoUrl.startsWith("https://github.com/")) {
                        const repoPath = repoUrl.replace("https://github.com/", "");
                        cloneUrl = `https://${accessToken}@github.com/${repoPath}`;
                    }

                    // 3. Clone
                    const git = simpleGit();
                    await git.clone(cloneUrl, tempDir, [
                        "--depth", "1",
                        ...(branch ? ["--branch", branch] : [])
                    ]);

                    // 4. Update Status -> Indexing
                    await db.update(projects).set({ syncStatus: "indexing" }).where(eq(projects.id, projectId));

                    // 5. Scan & Upload
                    const folderMap = await createDirectoryStructureFromRoot(projectId, tempDir, userId);
                    const fileCount = await uploadRepoFiles(projectId, tempDir, folderMap, userId);

                    // 6. Complete
                    await db.update(projects).set({ syncStatus: "ready" }).where(eq(projects.id, projectId));

                    return { success: true, fileCount };

                } finally {
                    // Cleanup in the same step
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            });

        } catch (error: any) {
            await step.run("handle-failure", async () => {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                console.error(`[Inngest] Import failed for ${projectId}`, error);

                await db.update(projects).set({
                    syncStatus: "failed",
                    importSource: sql`jsonb_set(COALESCE(${projects.importSource}, '{}'::jsonb), '{metadata,lastError}', ${JSON.stringify(errorMessage)}::jsonb)`
                }).where(eq(projects.id, projectId));
            });
            throw error;
        }
    }
);
