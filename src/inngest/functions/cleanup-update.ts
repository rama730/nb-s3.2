import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectUpdateComments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const cleanupProjectUpdate = inngest.createFunction(
    { id: "project-update-cleanup", name: "Cleanup Pinned Media and Comments for Deleted Updates" },
    { event: "project/updates.cleanup" },
    async ({ event, step }) => {
        const { updateId, media } = event.data;

        // 1. Soft-delete all associated comments in the background
        await step.run("soft-delete-comments", async () => {
            await db.update(projectUpdateComments)
                .set({ deletedAt: new Date() })
                .where(eq(projectUpdateComments.updateId, updateId));
        });

        // 2. Remove associated storage media items from their respective buckets
        await step.run("delete-storage-assets", async () => {
            const imagesWithStorage = media.filter((item: any) => item.storageKey && item.bucket);
            if (imagesWithStorage.length === 0) return { deletedCount: 0 };

            const { createAdminClient } = await import("@/lib/supabase/server");
            const adminClient = await createAdminClient();

            // Group by bucket to minimize requests if multiple buckets are involved
            const byBucket = imagesWithStorage.reduce((acc: Record<string, string[]>, item: any) => {
                const bucketItems = acc[item.bucket] ?? [];
                bucketItems.push(item.storageKey);
                acc[item.bucket] = bucketItems;
                return acc;
            }, {});

            let deletedCount = 0;
            for (const [bucket, keys] of Object.entries(byBucket)) {
                const { data, error } = await adminClient.storage.from(bucket).remove(keys);
                if (error) {
                    throw new Error(`Update-media cleanup failed for ${bucket}: ${error.message}`);
                } else if (data) {
                    deletedCount += data.length;
                }
            }

            return { deletedCount };
        });
    }
);
