import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectMarkdownAssets } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const cleanupProjectDocs = inngest.createFunction(
    { id: "project-docs-cleanup", name: "Cleanup Orphaned Storage Assets for Project Documentation" },
    { event: "project/docs.cleanup" },
    async ({ event, step }) => {
        const { projectId, assets } = event.data;

        if (assets.length === 0) return { deletedCount: 0 };

        // 1. Remove associated storage media items from their respective buckets
        const deletedCount = await step.run("delete-storage-assets", async () => {
            const { createAdminClient } = await import("@/lib/supabase/server");
            const adminClient = await createAdminClient();

            // Group by bucket to minimize requests
            const byBucket = assets.reduce((acc: Record<string, string[]>, item) => {
                const bucketItems = acc[item.bucket] ?? [];
                bucketItems.push(item.storageKey);
                acc[item.bucket] = bucketItems;
                return acc;
            }, {});

            let count = 0;
            for (const [bucket, keys] of Object.entries(byBucket)) {
                const { data, error } = await adminClient.storage.from(bucket).remove(keys);
                if (error) {
                    console.error(`cleanup-docs: failed to delete from bucket ${bucket}`, error);
                } else if (data) {
                    count += data.length;
                }
            }
            return count;
        });

        // 2. Hard delete the asset rows from the database (since they are now deleted from storage)
        await step.run("delete-db-assets", async () => {
            const assetIds = assets.map(a => a.id);
            await db.delete(projectMarkdownAssets)
                .where(inArray(projectMarkdownAssets.id, assetIds));
        });

        return { deletedCount };
    }
);
