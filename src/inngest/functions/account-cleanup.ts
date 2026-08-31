import { inngest } from "../client";
import { db } from "@/lib/db";
import { projects, messages, messageAttachments, accountDeletions } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { eq, and, asc, gt, inArray, isNotNull } from "drizzle-orm";
import { purgeUserCache } from "@/lib/utils/cdn";
import { verifySignedJobRequestToken } from "@/lib/security/job-request";

type AdminStorageClient = Awaited<ReturnType<typeof createAdminClient>>;

async function deleteStoragePrefix(
    admin: AdminStorageClient,
    bucket: string,
    rootPrefix: string,
): Promise<string[]> {
    const pendingPrefixes = [rootPrefix.replace(/\/$/, "")];
    const deleted: string[] = [];

    while (pendingPrefixes.length > 0) {
        const prefix = pendingPrefixes.pop()!;
        const files: string[] = [];
        for (let offset = 0; ; offset += 100) {
            const { data, error } = await admin.storage.from(bucket).list(prefix, {
                limit: 100,
                offset,
                sortBy: { column: "name", order: "asc" },
            });
            if (error) throw new Error(`${bucket}/${prefix} listing failed: ${error.message}`);
            if (!data?.length) break;
            for (const entry of data) {
                const path = `${prefix}/${entry.name}`;
                if (entry.id) files.push(path);
                else pendingPrefixes.push(path);
            }
            if (data.length < 100) break;
        }

        for (let index = 0; index < files.length; index += 100) {
            const batch = files.slice(index, index + 100);
            const { error } = await admin.storage.from(bucket).remove(batch);
            if (error) throw new Error(`${bucket}/${prefix} cleanup failed: ${error.message}`);
            deleted.push(...batch);
        }
    }

    return deleted;
}

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
        const { userId, deletionId, jobSignature } = event.data;

        const requestVerification = verifySignedJobRequestToken(jobSignature, {
            kind: "account/cleanup",
            actorId: userId,
            subjectId: deletionId,
        });
        if (!requestVerification.ok) {
            throw new Error("Invalid account cleanup job request");
        }

        // Mark cleanup as in progress
        await step.run("mark-in-progress", async () => {
            await db
                .update(accountDeletions)
                .set({ cleanupStatus: 'in_progress' })
                .where(eq(accountDeletions.id, deletionId));
        });

        const supabase = await createAdminClient();

        // Step 1: Delete every Storage domain owned by projects that will be
        // removed during phase two, including legacy/version/orphaned paths.
        const projectFileResults = await step.run("cleanup-project-files", async () => {
            let totalDeleted = 0;
            const totalErrors = 0;
            const deletedPaths: string[] = [];
            let cursor: string | null = null;
            const DB_PAGE_SIZE = 100;

            while (true) {
                const ownedProjects = await db
                    .select({ id: projects.id })
                    .from(projects)
                    .where(and(
                        eq(projects.ownerId, userId),
                        ...(cursor ? [gt(projects.id, cursor)] : []),
                    ))
                    .orderBy(asc(projects.id))
                    .limit(DB_PAGE_SIZE);
                if (ownedProjects.length === 0) break;
                cursor = ownedProjects[ownedProjects.length - 1]!.id;

                for (const project of ownedProjects) {
                    const domains = [
                        ["project-files", project.id],
                        ["project-files", `projects/${project.id}`],
                        ["project-files", `${userId}/project-images/${project.id}`],
                        ["project-files", `${userId}/project-covers/${project.id}`],
                        ["task-files", project.id],
                        ["project-updates-media", `projects/${project.id}`],
                    ] as const;
                    for (const [bucket, prefix] of domains) {
                        const removed = await deleteStoragePrefix(supabase, bucket, prefix);
                        totalDeleted += removed.length;
                        if (deletedPaths.length < 1_000) {
                            deletedPaths.push(...removed.slice(0, 1_000 - deletedPaths.length).map((path) => `${bucket}/${path}`));
                        }
                    }
                }
            }
            return { deleted: totalDeleted, errors: totalErrors, paths: deletedPaths };
        });

        // Step 2: Delete avatar files
        const avatarResults = await step.run("cleanup-avatars", async () => {
            const removed = await deleteStoragePrefix(supabase, "avatars", userId);
            return {
                deleted: removed.length,
                errors: 0,
                paths: removed.slice(0, 1_000).map((path) => `avatars/${path}`),
            };
        });

        // Step 3: Delete message attachment files
        const attachmentResults = await step.run("cleanup-message-attachments", async () => {
            let totalDeleted = 0;
            const totalErrors = 0;
            const deletedPaths: string[] = [];
            let cursor: string | null = null;

            while (true) {
                const attachments = await db
                    .select({ id: messageAttachments.id, storagePath: messageAttachments.storagePath })
                    .from(messageAttachments)
                    .innerJoin(messages, eq(messageAttachments.messageId, messages.id))
                    .where(and(
                        eq(messages.senderId, userId),
                        isNotNull(messageAttachments.storagePath),
                        ...(cursor ? [gt(messageAttachments.id, cursor)] : []),
                    ))
                    .orderBy(asc(messageAttachments.id))
                    .limit(500);
                if (attachments.length === 0) break;
                cursor = attachments[attachments.length - 1]!.id;
                const attachmentBatch = attachments.filter(
                    (attachment): attachment is { id: string; storagePath: string } => Boolean(attachment.storagePath?.trim()),
                );
                const batch = attachmentBatch.map((attachment) => attachment.storagePath);
                if (batch.length === 0) continue;
                try {
                    const { error } = await supabase.storage.from('chat-attachments').remove(batch);
                    if (error) {
                        throw new Error(`Message attachment cleanup failed: ${error.message}`);
                    } else {
                        totalDeleted += batch.length;
                        if (deletedPaths.length < 1_000) {
                            deletedPaths.push(...batch.slice(0, 1_000 - deletedPaths.length).map(p => `chat-attachments/${p}`));
                        }
                        await db
                            .delete(messageAttachments)
                            .where(inArray(messageAttachments.id, attachmentBatch.map((attachment) => attachment.id)));
                    }
                } catch (e) {
                    throw e instanceof Error ? e : new Error('Message attachment cleanup failed');
                }
            }

            // Metadata can be absent or already purged. The sender-owned prefix
            // is the final authority for otherwise unreachable attachment bodies.
            const orphanedSenderObjects = await deleteStoragePrefix(supabase, "chat-attachments", userId);
            totalDeleted += orphanedSenderObjects.length;
            if (deletedPaths.length < 1_000) {
                deletedPaths.push(...orphanedSenderObjects
                    .slice(0, 1_000 - deletedPaths.length)
                    .map((path) => `chat-attachments/${path}`));
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
