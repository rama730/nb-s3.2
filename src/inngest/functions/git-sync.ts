import { inngest } from "../client";
import simpleGit from "simple-git";
import { db } from "@/lib/db";
import { projects, projectNodes, projectNodeEvents, projectNodeLocks } from "@/lib/db/schema";
import { eq, and, isNull, lt } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/server";
import { tmpdir } from "os";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises";
import { join, relative, dirname } from "path";
import { readdirSync, statSync } from "fs";
import { createHash } from "crypto";

function computeFileHash(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

function walkDir(dir: string, base: string = dir): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (entry === ".git") continue;
        const full = join(dir, entry);
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

export const gitPush = inngest.createFunction(
    { id: "git-push", retries: 1 },
    { event: "git/push" },
    async ({ event, step }) => {
        const { projectId, commitMessage, userId } = event.data;

        await step.run("push-to-github", async () => {
            const [project] = await db
                .select({
                    githubRepoUrl: projects.githubRepoUrl,
                    githubDefaultBranch: projects.githubDefaultBranch,
                })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!project?.githubRepoUrl) {
                throw new Error("No GitHub repository connected");
            }

            const tempDir = await mkdtemp(join(tmpdir(), "nb-git-push-"));

            try {
                const git = simpleGit();
                await git.clone(project.githubRepoUrl, tempDir, [
                    "--depth",
                    "1",
                    "--single-branch",
                    "--branch",
                    project.githubDefaultBranch ?? "main",
                ]);

                const activeNodes = await db
                    .select({
                        id: projectNodes.id,
                        name: projectNodes.name,
                        parentId: projectNodes.parentId,
                        type: projectNodes.type,
                        s3Key: projectNodes.s3Key,
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

                const fileNodes = activeNodes.filter((n) => n.type === "file" && n.s3Key);
                for (const node of fileNodes) {
                    const filePath = buildNodePath(node.id, nodesById);
                    const targetPath = join(tempDir, filePath);

                    await mkdir(dirname(targetPath), { recursive: true });

                    const { data, error } = await adminClient.storage
                        .from("project-files")
                        .download(node.s3Key!);

                    if (error) {
                        console.error(`[git-push] Failed to download ${node.s3Key}:`, error.message);
                        continue;
                    }

                    const buffer = Buffer.from(await data.arrayBuffer());
                    await writeFile(targetPath, buffer);
                }

                const repoGit = simpleGit(tempDir);
                await repoGit.add(".");
                await repoGit.commit(commitMessage || "Update from NB workspace");
                await repoGit.push("origin", project.githubDefaultBranch ?? "main");

                const log = await repoGit.log({ maxCount: 1 });
                const latestSha = log.latest?.hash ?? null;

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
                    },
                });

                return { success: true, commitSha: latestSha };
            } finally {
                await rm(tempDir, { recursive: true, force: true }).catch(() => {});
            }
        });
    },
);

export const gitPull = inngest.createFunction(
    { id: "git-pull", retries: 1 },
    { event: "git/pull" },
    async ({ event, step }) => {
        const { projectId, userId } = event.data;

        await step.run("pull-from-github", async () => {
            const [project] = await db
                .select({
                    githubRepoUrl: projects.githubRepoUrl,
                    githubDefaultBranch: projects.githubDefaultBranch,
                })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!project?.githubRepoUrl) {
                throw new Error("No GitHub repository connected");
            }

            const tempDir = await mkdtemp(join(tmpdir(), "nb-git-pull-"));

            try {
                const git = simpleGit();
                await git.clone(project.githubRepoUrl, tempDir, [
                    "--depth",
                    "1",
                    "--single-branch",
                    "--branch",
                    project.githubDefaultBranch ?? "main",
                ]);

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
                    const fullPath = join(tempDir, filePath);
                    const content = await readFile(fullPath);
                    const hash = computeFileHash(content);

                    const existingNode = nodeByPath.get(filePath);

                    if (existingNode && existingNode.type === "file") {
                        if (existingNode.gitHash === hash) continue;

                        if (existingNode.s3Key) {
                            await adminClient.storage
                                .from("project-files")
                                .update(existingNode.s3Key, content, {
                                    contentType: "application/octet-stream",
                                    upsert: true,
                                });
                        }

                        await db
                            .update(projectNodes)
                            .set({
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

                        const s3Key = `${projectId}/${crypto.randomUUID()}/${fileName}`;
                        await adminClient.storage
                            .from("project-files")
                            .upload(s3Key, content, {
                                contentType: "application/octet-stream",
                            });

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

                const deletedCount = { value: 0 };
                for (const node of existingNodes) {
                    if (node.type !== "file") continue;
                    const path = buildNodePath(node.id, nodesById);
                    if (!seenPaths.has(path)) {
                        await db
                            .update(projectNodes)
                            .set({ deletedAt: new Date(), deletedBy: userId })
                            .where(eq(projectNodes.id, node.id));
                        deletedCount.value++;
                    }
                }

                const repoGit = simpleGit(tempDir);
                const log = await repoGit.log({ maxCount: 1 });
                const latestSha = log.latest?.hash ?? null;

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
                        deletedFiles: deletedCount.value,
                    },
                });

                return {
                    success: true,
                    newFiles: newCount,
                    updatedFiles: updatedCount,
                    deletedFiles: deletedCount.value,
                };
            } finally {
                await rm(tempDir, { recursive: true, force: true }).catch(() => {});
            }
        });
    },
);

export const lockCleanup = inngest.createFunction(
    { id: "lock-cleanup" },
    { cron: "*/5 * * * *" },
    async () => {
        const result = await db
            .delete(projectNodeLocks)
            .where(lt(projectNodeLocks.expiresAt, new Date()));

        return { cleaned: true };
    },
);
