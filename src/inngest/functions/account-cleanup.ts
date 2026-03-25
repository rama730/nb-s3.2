import { inngest } from "../client";
import { db } from "@/lib/db";
import { projects, projectNodes, messages, messageAttachments, accountDeletions } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, isNotNull } from "drizzle-orm";
import { purgeUserCache } from "@/lib/utils/cdn";

/**
 * Async S3 cleanup for account deletion.
 * Runs as a background job with automatic retries via Inngest step mechanism.
 * Triggered by `account/cleanup` event from scheduleAccountDeletion().
 */
export const accountCleanup = inngest.createFunction(
    {
        id: "account-cleanup",
        name: "Account Deletion S3 Cleanup",
        retries: 3,
    },
    { event: "account/cleanup" },
    async ({ event, step }) => {
        const { userId, deletionId } = event.data;

        // Mark cleanup as in progress
        await step.run("mark-in-progress", async () => {
            await db
                .update(accountDeletions)
                .set({ cleanupStatus: 'in_progress' })
                .where(eq(accountDeletions.id, deletionId));
        });

        const supabase = await createClient();

        // Step 1: Delete S3 project files
        const projectFileResults = await step.run("cleanup-project-files", async () => {
            const files = await db
                .select({ s3Key: projectNodes.s3Key })
                .from(projectNodes)
                .innerJoin(projects, eq(projectNodes.projectId, projects.id))
                .where(
                    and(
                        eq(projects.ownerId, userId),
                        eq(projectNodes.type, 'file'),
                        isNotNull(projectNodes.s3Key)
                    )
                );

            if (files.length === 0) return { deleted: 0, errors: 0, paths: [] };

            const s3Keys = files.map(f => f.s3Key as string).filter(k => k.length > 0);
            let totalDeleted = 0;
            let totalErrors = 0;
            const deletedPaths: string[] = [];

            const S3_BATCH_SIZE = 1000;
            for (let j = 0; j < s3Keys.length; j += S3_BATCH_SIZE) {
                const batch = s3Keys.slice(j, j + S3_BATCH_SIZE);
                try {
                    const { error } = await supabase.storage.from('project-files').remove(batch);
                    if (error) {
                        console.error('S3 project file batch delete error:', error);
                        totalErrors += batch.length;
                    } else {
                        totalDeleted += batch.length;
                        deletedPaths.push(...batch.map(p => `project-files/${p}`));
                    }
                } catch (e) {
                    console.error('S3 project file batch delete exception:', e);
                    totalErrors += batch.length;
                }
            }
            return { deleted: totalDeleted, errors: totalErrors, paths: deletedPaths };
        });

        // Step 2: Delete avatar files
        const avatarResults = await step.run("cleanup-avatars", async () => {
            try {
                const { data: avatarFiles } = await supabase.storage
                    .from('avatars')
                    .list('', { search: userId, limit: 100 });

                if (avatarFiles && avatarFiles.length > 0) {
                    const filesToDelete = avatarFiles.map(f => f.name);
                    const { error } = await supabase.storage.from('avatars').remove(filesToDelete);
                    if (error) {
                        console.error('Avatar cleanup error:', error);
                        return { deleted: 0, errors: filesToDelete.length, paths: [] };
                    }
                    const paths = filesToDelete.map(f => `avatars/${f}`);
                    return { deleted: filesToDelete.length, errors: 0, paths };
                }
                return { deleted: 0, errors: 0, paths: [] };
            } catch (e) {
                console.error('Avatar cleanup exception:', e);
                return { deleted: 0, errors: 1, paths: [] };
            }
        });

        // Step 3: Delete message attachment files
        const attachmentResults = await step.run("cleanup-message-attachments", async () => {
            const attachments = await db
                .select({ storagePath: messageAttachments.storagePath })
                .from(messageAttachments)
                .innerJoin(messages, eq(messageAttachments.messageId, messages.id))
                .where(and(eq(messages.senderId, userId), isNotNull(messageAttachments.storagePath)));

            if (attachments.length === 0) return { deleted: 0, errors: 0, paths: [] };

            const paths = attachments.map(a => a.storagePath as string).filter(p => p.length > 0);
            let totalDeleted = 0;
            let totalErrors = 0;
            const deletedPaths: string[] = [];

            const S3_BATCH_SIZE = 1000;
            for (let j = 0; j < paths.length; j += S3_BATCH_SIZE) {
                const batch = paths.slice(j, j + S3_BATCH_SIZE);
                try {
                    const { error } = await supabase.storage.from('message-attachments').remove(batch);
                    if (error) {
                        console.error('Message attachment cleanup error:', error);
                        totalErrors += batch.length;
                    } else {
                        totalDeleted += batch.length;
                        deletedPaths.push(...batch.map(p => `message-attachments/${p}`));
                    }
                } catch (e) {
                    console.error('Message attachment cleanup exception:', e);
                    totalErrors += batch.length;
                }
            }
            return { deleted: totalDeleted, errors: totalErrors, paths: deletedPaths };
        });

        // Step 4: CDN Purge (Architectural Hook)
        const allPaths = [
            ...projectFileResults.paths,
            ...avatarResults.paths,
            ...attachmentResults.paths
        ];

        if (allPaths.length > 0) {
            await step.run("cdn-purge", async () => {
                await purgeUserCache(userId, allPaths);
            });
        }

        // Step 5: Mark cleanup as completed
        const totalErrors = projectFileResults.errors + avatarResults.errors + attachmentResults.errors;

        await step.run("mark-completed", async () => {
            await db
                .update(accountDeletions)
                .set({
                    cleanupStatus: totalErrors > 0 ? 'failed' : 'completed',
                    cleanupDetails: {
                        projectFiles: { deleted: projectFileResults.deleted, errors: projectFileResults.errors },
                        avatars: { deleted: avatarResults.deleted, errors: avatarResults.errors },
                        messageAttachments: { deleted: attachmentResults.deleted, errors: attachmentResults.errors },
                        completedAt: new Date().toISOString(),
                    },
                })
                .where(eq(accountDeletions.id, deletionId));
        });

        return {
            deletionId,
            userId,
            projectFiles: projectFileResults,
            avatars: avatarResults,
            messageAttachments: attachmentResults,
            status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
        };
    }
);

