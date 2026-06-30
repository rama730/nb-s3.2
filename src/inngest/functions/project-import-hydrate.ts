import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectNodes, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchAndParseTarball } from "@/lib/github/tarball-stream";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";

const UPLOAD_CONCURRENCY = 5;

export const projectImportHydrate = inngest.createFunction(
    { id: "project-import-hydrate", concurrency: 2, retries: 0 },
    { event: "project/import.hydrate" },
    async ({ event, step }) => {
        const { projectId, importSource, userId } = event.data;

        await step.run("tarball-hydrate", async () => {
            const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
            const branch = importSource.branch || "main";
            
            const adminClient = await createAdminClient();
            
            // Get all virtual nodes for this project
            const nodes = await db.query.projectNodes.findMany({
                where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, 'file')),
                columns: { id: true, path: true, mimeType: true, s3Key: true }
            });

            const project = await db.query.projects.findFirst({
                where: eq(projects.id, projectId),
                columns: { importSource: true }
            });

            if (project?.importSource) {
                const currentSource = project.importSource as any;
                await db.update(projects)
                    .set({
                        importSource: {
                            ...currentSource,
                            metadata: {
                                ...currentSource.metadata,
                                hydration: {
                                    status: "in_progress",
                                    total: nodes.length,
                                    completed: 0
                                }
                            }
                        }
                    })
                    .where(eq(projects.id, projectId));
            }

            // Fast lookup by normalized path
            const nodeMap = new Map<string, typeof nodes[0]>();
            for (const n of nodes) {
                // Remove leading slash from db path
                const normalizedPath = n.path.startsWith('/') ? n.path.slice(1) : n.path;
                nodeMap.set(normalizedPath, n);
            }

            const stream = fetchAndParseTarball(importSource.repoUrl, branch, token);
            let inFlight: Promise<void>[] = [];
            let uploaded = 0;
            let lastReportedUploadCount = 0;

            for await (const file of stream) {
                const node = nodeMap.get(file.path);
                // Skip if we don't have a virtual node or if it's already hydrated
                if (!node || node.s3Key) continue;

                const s3Key = buildProjectFileKey(projectId, file.path);

                const uploadTask = async () => {
                    const { error } = await adminClient.storage
                        .from('project-files')
                        .upload(s3Key, file.content, {
                            contentType: node.mimeType || 'application/octet-stream',
                            upsert: true
                        });
                    
                    if (!error) {
                        await db.update(projectNodes)
                            .set({ s3Key, updatedAt: new Date() })
                            .where(eq(projectNodes.id, node.id));
                        uploaded++;
                    } else {
                        console.error(`[Hydrate] Failed to upload ${file.path}`, error);
                    }
                };

                inFlight.push(uploadTask());

                if (inFlight.length >= UPLOAD_CONCURRENCY) {
                    await Promise.all(inFlight);
                    inFlight = [];

                    // Batch update progress every 100 files
                    if (uploaded - lastReportedUploadCount >= 100) {
                        lastReportedUploadCount = uploaded;
                        const proj = await db.query.projects.findFirst({
                            where: eq(projects.id, projectId),
                            columns: { importSource: true }
                        });
                        if (proj?.importSource) {
                            const currentSource = proj.importSource as any;
                            if (currentSource.metadata?.hydration) {
                                currentSource.metadata.hydration.completed = uploaded;
                                await db.update(projects)
                                    .set({ importSource: currentSource })
                                    .where(eq(projects.id, projectId));
                            }
                        }
                    }
                }
            }

            if (inFlight.length > 0) {
                await Promise.all(inFlight);
            }

            // Mark project as fully synced and hydration done
            const finalProj = await db.query.projects.findFirst({
                where: eq(projects.id, projectId),
                columns: { importSource: true }
            });
            let finalImportSource = finalProj?.importSource as any;
            if (finalImportSource?.metadata?.hydration) {
                finalImportSource.metadata.hydration.status = "done";
                finalImportSource.metadata.hydration.completed = uploaded;
            }

            await db.update(projects)
                .set({ 
                    syncStatus: "ready", 
                    importSource: finalImportSource,
                    updatedAt: new Date() 
                })
                .where(eq(projects.id, projectId));

            return { uploaded };
        });
    }
);
