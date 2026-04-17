import { inngest } from "../client";
import { db } from "@/lib/db";
import { accountDeletions } from "@/lib/db/schema";
import { and, lte, isNull } from "drizzle-orm";
import {
    ACCOUNT_HARD_DELETE_JOB_KIND,
    executeHardDelete,
} from "@/lib/account/hard-delete";
import { createSignedJobRequestToken } from "@/lib/security/job-request";

/**
 * Daily cron job that hard-deletes accounts whose grace period has expired.
 * Runs every day at 02:00 UTC to process expired account deletions.
 */
export const accountHardDelete = inngest.createFunction(
    {
        id: "account-hard-delete",
        name: "Account Hard Delete (Grace Period Expiry)",
        retries: 2,
        concurrency: {
            limit: 1,
            key: "account-hard-delete-global",
        },
    },
    { cron: "0 2 * * *" }, // Every day at 02:00 UTC
    async ({ step }) => {
        const now = new Date();

        // Find all eligible deletions
        const eligibleDeletions = await step.run("find-eligible", async () => {
            return db
                .select({
                    id: accountDeletions.id,
                    userId: accountDeletions.userId,
                    email: accountDeletions.email,
                })
                .from(accountDeletions)
                .where(
                    and(
                        lte(accountDeletions.hardDeleteAt, now),
                        isNull(accountDeletions.cancelledAt),
                        isNull(accountDeletions.completedAt),
                    )
                );
        });

        if (eligibleDeletions.length === 0) {
            return { processed: 0, skipped: 'no_eligible_deletions' };
        }

        const results = {
            processed: 0,
            succeeded: 0,
            failed: 0,
            details: [] as Array<{ deletionId: string; userId: string; success: boolean; error?: string }>,
        };

        // Process each deletion in a separate step for individual retry
        for (const deletion of eligibleDeletions) {
            const result = await step.run(`hard-delete-${deletion.id}`, async () => {
                try {
                    // SEC-C3: mint a short-lived signed token bound to this
                    // specific (userId, deletionId) so the finalizer can
                    // prove the request originated from the Inngest runtime
                    // that holds the shared secret, not a forged RPC call.
                    const jobSignature = createSignedJobRequestToken({
                        kind: ACCOUNT_HARD_DELETE_JOB_KIND,
                        actorId: deletion.userId,
                        subjectId: deletion.id,
                        ttlSeconds: 600,
                    });
                    const deleteResult = await executeHardDelete(
                        deletion.userId,
                        deletion.id,
                        jobSignature,
                    );
                    return {
                        deletionId: deletion.id,
                        userId: deletion.userId,
                        success: deleteResult.success,
                        error: deleteResult.error,
                    };
                } catch (error) {
                    return {
                        deletionId: deletion.id,
                        userId: deletion.userId,
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            });

            results.processed++;
            if (result.success) {
                results.succeeded++;
            } else {
                results.failed++;
            }
            results.details.push(result);
        }

        if (results.failed > 0) {
            console.error('account-hard-delete: some deletions failed', {
                failed: results.failed,
                details: results.details.filter(d => !d.success),
            });
        }

        return results;
    }
);
