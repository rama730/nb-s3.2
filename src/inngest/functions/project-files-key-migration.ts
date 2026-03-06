import { and, eq, isNotNull, isNull, like } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectNodeEvents, projectNodes } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProjectFileKey, parseProjectFileKey } from "@/lib/storage/project-file-key";

const LEGACY_BATCH_SIZE = 50;
const MAX_MIGRATION_BYTES_PER_RUN = 100 * 1024 * 1024; // 100 MB

function isAlreadyExistsError(error: { message?: string } | null): boolean {
    const msg = error?.message?.toLowerCase() || "";
    return msg.includes("already exists") || msg.includes("duplicate") || msg.includes("409");
}

export const migrateProjectFileLegacyKeys = inngest.createFunction(
    { id: "project-files-key-migration", retries: 1 },
    { cron: "0 * * * *" },
    async () => {
        const admin = await createAdminClient();

        const rows = await db
            .select({
                nodeId: projectNodes.id,
                projectId: projectNodes.projectId,
                s3Key: projectNodes.s3Key,
                size: projectNodes.size,
            })
            .from(projectNodes)
            .where(
                and(
                    eq(projectNodes.type, "file"),
                    isNull(projectNodes.deletedAt),
                    isNotNull(projectNodes.s3Key),
                    like(projectNodes.s3Key, "projects/%"),
                ),
            )
            .limit(LEGACY_BATCH_SIZE);

        if (rows.length === 0) {
            return { scanned: 0, migrated: 0, skipped: 0, failed: 0 };
        }

        let migrated = 0;
        let skipped = 0;
        let failed = 0;
        let migratedBytes = 0;

        for (const row of rows) {
            const oldKey = row.s3Key;
            if (!oldKey) {
                skipped += 1;
                continue;
            }

            const parsed = parseProjectFileKey(oldKey);
            if (!parsed || parsed.format !== "legacy") {
                skipped += 1;
                continue;
            }
            if (parsed.projectId !== row.projectId) {
                skipped += 1;
                continue;
            }

            const newKey = buildProjectFileKey(parsed.projectId, parsed.relativePath);
            if (newKey === oldKey) {
                skipped += 1;
                continue;
            }

            const rowSize = Math.max(0, row.size || 0);
            if (migratedBytes + rowSize > MAX_MIGRATION_BYTES_PER_RUN) {
                break;
            }

            const download = await admin.storage.from("project-files").download(oldKey);
            if (download.error || !download.data) {
                failed += 1;
                continue;
            }

            const body = Buffer.from(await download.data.arrayBuffer());
            const upload = await admin.storage
                .from("project-files")
                .upload(newKey, body, {
                    contentType: "application/octet-stream",
                    upsert: false,
                });

            if (upload.error && !isAlreadyExistsError(upload.error)) {
                failed += 1;
                continue;
            }

            await db.transaction(async (tx) => {
                await tx
                    .update(projectNodes)
                    .set({
                        s3Key: newKey,
                        updatedAt: new Date(),
                    })
                    .where(and(eq(projectNodes.id, row.nodeId), eq(projectNodes.projectId, row.projectId)));

                await tx.insert(projectNodeEvents).values({
                    projectId: row.projectId,
                    nodeId: row.nodeId,
                    actorId: null,
                    type: "storage_key_migrated",
                    metadata: { oldKey, newKey },
                    createdAt: new Date(),
                });
            });

            await admin.storage.from("project-files").remove([oldKey]).catch(() => null);
            migrated += 1;
            migratedBytes += rowSize;
        }

        return {
            scanned: rows.length,
            migrated,
            skipped,
            failed,
            migratedBytes,
        };
    },
);

