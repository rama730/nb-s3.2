import { and, eq, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountDeletions,
  conversationParticipants,
  dmPairs,
  profiles,
  projects,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { verifySignedJobRequestToken } from "@/lib/security/job-request";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ACCOUNT_HARD_DELETE_JOB_KIND = "account/hard-delete";

/**
 * SEC-C3: permanently delete a user's account and all associated data.
 *
 * This is NOT a `'use server'` server action — it lives in `src/lib` so it is
 * never exposed to the browser as an RPC endpoint. The only supported call
 * site is the Inngest cron (`src/inngest/functions/account-hard-delete.ts`),
 * which must mint a signed job-request token with the matching kind / actor /
 * subject triple. Any caller that cannot produce a valid token is rejected
 * before a single row is touched.
 *
 * DESTRUCTIVE — cannot be undone.
 */
export async function executeHardDelete(
  userId: string,
  deletionId: string,
  jobSignature: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!UUID_RE.test(userId)) {
      return { success: false, error: "Invalid user ID" };
    }
    if (!UUID_RE.test(deletionId)) {
      return { success: false, error: "Invalid deletion ID" };
    }

    // SEC-C3: require a valid signed job-request token. The token binds the
    // hard-delete to the exact (userId, deletionId) pair so a leaked token
    // can't be replayed against a different account.
    const signature = verifySignedJobRequestToken(jobSignature, {
      kind: ACCOUNT_HARD_DELETE_JOB_KIND,
      actorId: userId,
      subjectId: deletionId,
    });
    if (!signature.ok) {
      logger.error("account.hard-delete.unauthorized", {
        module: "account",
        userId,
        deletionId,
      });
      return { success: false, error: "Unauthorized" };
    }

    // Verify the deletion record exists, matches the subject, and is eligible.
    const [deletion] = await db
      .select({ id: accountDeletions.id })
      .from(accountDeletions)
      .where(
        and(
          eq(accountDeletions.id, deletionId),
          eq(accountDeletions.userId, userId),
          isNull(accountDeletions.cancelledAt),
          isNull(accountDeletions.completedAt),
        ),
      )
      .limit(1);

    if (!deletion) {
      return {
        success: false,
        error: "Deletion record not found or already processed",
      };
    }

    // C9: Delete auth user FIRST to avoid orphaned auth records.
    // If auth deletion fails, DB data is preserved and can be retried.
    const supabase = await createClient();
    let authError: { message: string } | null = null;
    try {
      const adminResult = await supabase.auth.admin?.deleteUser?.(userId);
      if (adminResult?.error) {
        authError = adminResult.error;
      }
    } catch {
      // Admin API not available, try RPC
      try {
        const { error } = await supabase.rpc("delete_auth_user", { user_id: userId });
        if (error) authError = error;
      } catch {
        authError = { message: "Auth deletion not available" };
      }
    }

    if (authError) {
      logger.error("account.hard-delete.auth-deletion.failed", {
        module: "account",
        error: authError.message,
      });
      // Auth deletion failed — abort to prevent orphaned auth record.
      // The Inngest job will retry on next scheduled attempt.
      return { success: false, error: `Auth deletion failed: ${authError.message}` };
    }

    // Run destructive DB deletes in a transaction (auth user already removed)
    await db.transaction(async (tx) => {
      // 1. Remove the user from conversations during the irreversible finalizer path.
      await tx
        .delete(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

      // 2. Remove DM pair entries during hard delete so soft delete remains reversible.
      await tx
        .delete(dmPairs)
        .where(or(eq(dmPairs.userLow, userId), eq(dmPairs.userHigh, userId)));

      // 3. Delete projects owned by the user (cascade handles members, tasks, nodes, etc.)
      await tx.delete(projects).where(eq(projects.ownerId, userId));

      // 4. Delete the profile (cascade handles remaining FKs)
      await tx.delete(profiles).where(eq(profiles.id, userId));

      // 5. Mark deletion as completed
      await tx
        .update(accountDeletions)
        .set({ completedAt: new Date(), cleanupStatus: "completed" })
        .where(eq(accountDeletions.id, deletionId));
    });

    return { success: true };
  } catch (error) {
    logger.error("account.hard-delete.failed", {
      module: "account",
      error: error instanceof Error ? error.message : String(error),
    });

    // Mark the deletion as failed
    try {
      await db
        .update(accountDeletions)
        .set({
          cleanupStatus: "failed",
          cleanupDetails: {
            error: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString(),
          },
        })
        .where(eq(accountDeletions.id, deletionId));
    } catch {
      // Best effort
    }

    return { success: false, error: "Failed to execute hard delete" };
  }
}
