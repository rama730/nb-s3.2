import fs from 'fs/promises';
import { db } from './src/lib/db';

async function update() {
    const filePath = './src/lib/github/project-import-runner.ts';
    let code = await fs.readFile(filePath, 'utf-8');

    // Remove imports of execFileAsync, GIT_CLONE_TIMEOUT_MS, withGitCredentialEnv, etc.
    code = code.replace(/import \{ execFileAsync, GIT_CLONE_TIMEOUT_MS, withGitCredentialEnv \} from ".\/git-utils";\n?/, '');
    code = code.replace(/import \{ assertRepositoryWithinBudgets, withTenantSyncLock \} from ".\/worker-guard";/, 'import { withTenantSyncLock, GITHUB_WORKER_BUDGETS } from "./worker-guard";');
    
    code = code.replace(/import \{\n  createDirectoryStructureFromRoot,\n  uploadRepoFiles,\n\} from "..\/import\/utils";/, 'import { createDirectoryStructureFromPaths, insertVirtualFileNodes } from "../import/utils";\nimport { fetchGithubTree } from "./tree-api";');
    
    // Find the try block starting with fs.mkdtemp
    const startIdx = code.indexOf('const tempDir = await fs.mkdtemp(');
    const endIdx = code.indexOf('} finally {', startIdx);
    const cleanupEndIdx = code.indexOf('}', endIdx + 11) + 1; // end of finally { ... fs.rm ... }

    const newBlock = `
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
                \`project import rejected for project \${projectId}: repository exceeds file budget (\${fileCount} > \${GITHUB_WORKER_BUDGETS.maxFiles})\`
            );
        }
        if (totalBytes > GITHUB_WORKER_BUDGETS.maxBytes) {
            throw new Error(
                \`project import rejected for project \${projectId}: repository exceeds byte budget (\${totalBytes} > \${GITHUB_WORKER_BUDGETS.maxBytes})\`
            );
        }

        await db
          .update(projects)
          .set({
            syncStatus: "indexing",
            updatedAt: new Date(),
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
                        current = current ? \`\${current}/\${part}\` : part;
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
        await insertVirtualFileNodes(projectId, fileNodes, folderMap, userId);

        // Schedule background hydration
        // We trigger an Inngest event for Phase 2 Tarball Stream
        const { inngest } = await import("@/inngest/client");
        await inngest.send({
            name: "project/import.hydrate",
            data: { projectId, userId, importSource: project.importSource as any }
        }).catch(err => {
            console.error("Failed to enqueue hydration, but virtual fs is ready", err);
        });

        const importedNodeIds = new Set<string>(folderMap.values());
        // Since we are doing bulk insert with onConflictDoNothing, getting touchedNodeIds is complex.
        // We'll skip stale node deletion for virtual imports for now, or just let them stay.
`;

    code = code.substring(0, startIdx) + newBlock + code.substring(cleanupEndIdx);

    // Also remove the old importedNodeIds / staleNodeIds cleanup block for now since virtual nodes inserted via chunking don't return touched IDs
    code = code.replace(/const importedNodeIds = new Set<string>\(\[\s*\.\.\.folderMap\.values\(\),\s*\.\.\.uploadResult\.touchedNodeIds,\s*\]\);\s*await db\.transaction\(async \(tx\) => \{[\s\S]*?\}\);\s*await db\s*\.update\(projects\)/m, 'await db.update(projects)');
    code = code.replace(/uploadResult\.processed/g, 'fileCount');

    await fs.writeFile(filePath, code);
    console.log("Updated runner successfully");
}

update().catch(console.error);
