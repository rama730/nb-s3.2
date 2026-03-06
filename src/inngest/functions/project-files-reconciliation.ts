import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectNodeEvents, projectNodes } from "@/lib/db/schema";

const MAX_PROJECTS_PER_RUN = 20;
const MAX_KEYS_PER_PROJECT = 200;
const MAX_EVENTS_PER_RUN = 200;

type ActiveFileRow = {
    nodeId: string;
    projectId: string;
    s3Key: string;
};

type StorageObjectRow = {
    name: string;
};

export const reconcileProjectFiles = inngest.createFunction(
    { id: "project-files-reconciliation", retries: 1 },
    { cron: "*/15 * * * *" },
    async () => {
        const rows = await db
            .select({
                nodeId: projectNodes.id,
                projectId: projectNodes.projectId,
                s3Key: projectNodes.s3Key,
            })
            .from(projectNodes)
            .where(
                and(
                    eq(projectNodes.type, "file"),
                    isNull(projectNodes.deletedAt),
                    isNotNull(projectNodes.s3Key),
                ),
            )
            .limit(MAX_PROJECTS_PER_RUN * MAX_KEYS_PER_PROJECT);

        const activeFiles = rows
            .filter((row) => !!row.s3Key)
            .map((row) => ({
                nodeId: row.nodeId,
                projectId: row.projectId,
                s3Key: row.s3Key!,
            })) as ActiveFileRow[];

        if (activeFiles.length === 0) {
            return { scannedProjects: 0, missingObjects: 0, orphanObjects: 0, emittedEvents: 0 };
        }

        const byProject = new Map<string, ActiveFileRow[]>();
        for (const row of activeFiles) {
            const bucket = byProject.get(row.projectId) || [];
            if (bucket.length >= MAX_KEYS_PER_PROJECT) continue;
            bucket.push(row);
            byProject.set(row.projectId, bucket);
        }

        let missingObjects = 0;
        let orphanObjects = 0;
        let emittedEvents = 0;
        let skippedProjects = 0;

        for (const [projectId, files] of Array.from(byProject.entries()).slice(0, MAX_PROJECTS_PER_RUN)) {
            const canonicalPrefix = `${projectId}/%`;
            const legacyPrefix = `projects/${projectId}/%`;

            let storageRows: StorageObjectRow[] = [];
            try {
                const storageRowsResult = await db.execute<StorageObjectRow>(sql`
                    SELECT name
                    FROM storage.objects
                    WHERE bucket_id = 'project-files'
                      AND (name LIKE ${canonicalPrefix} OR name LIKE ${legacyPrefix})
                    ORDER BY name ASC
                    LIMIT ${MAX_KEYS_PER_PROJECT}
                `);
                storageRows = Array.from(storageRowsResult);
            } catch (error) {
                console.warn("[project-files-reconciliation] failed to query storage.objects", {
                    projectId,
                    error: error instanceof Error ? error.message : String(error),
                });
                skippedProjects += 1;
                continue;
            }
            const storageKeySet = new Set(storageRows.map((row) => row.name));
            const dbKeySet = new Set(files.map((file) => file.s3Key));

            const missingForProject = files.filter((file) => !storageKeySet.has(file.s3Key));
            const orphanForProject = storageRows.filter((row) => !dbKeySet.has(row.name));

            missingObjects += missingForProject.length;
            orphanObjects += orphanForProject.length;

            const events = [];

            for (const file of missingForProject) {
                if (emittedEvents >= MAX_EVENTS_PER_RUN) break;
                events.push({
                    projectId,
                    nodeId: file.nodeId,
                    actorId: null,
                    type: "storage_reconcile_missing_object",
                    metadata: { s3Key: file.s3Key },
                    createdAt: new Date(),
                });
                emittedEvents++;
            }

            for (const orphan of orphanForProject) {
                if (emittedEvents >= MAX_EVENTS_PER_RUN) break;
                events.push({
                    projectId,
                    nodeId: null,
                    actorId: null,
                    type: "storage_reconcile_orphan_object",
                    metadata: { s3Key: orphan.name },
                    createdAt: new Date(),
                });
                emittedEvents++;
            }

            if (events.length > 0) {
                await db.insert(projectNodeEvents).values(events);
            }

            if (emittedEvents >= MAX_EVENTS_PER_RUN) break;
        }

        return {
            scannedProjects: Math.min(byProject.size, MAX_PROJECTS_PER_RUN),
            missingObjects,
            orphanObjects,
            emittedEvents,
            skippedProjects,
        };
    },
);
